import type { z } from "zod";
import {
  checkExpression,
  checkModel,
  compile,
  modelIdentifiers,
  resolve,
  templateReferences,
} from "../expr";
import { sceneLimits } from "../tokens";
import {
  BLOCK_ELEMENT_TYPES,
  DocumentSchema,
  ELEMENT_SLOTS,
  LAYOUT_SLOTS,
  OutlineSchema,
  PLAYABLE_ELEMENT_TYPES,
  SceneSchema,
  WORLD_ELEMENT_TYPES,
  type ExplanationDocument,
  type Outline,
  type Quiz,
  type Scene,
  type SceneElement,
  type SceneRole,
  type SlotName,
} from "./document";
import { elementExtent, elementLookup, plotDomain, resolvePoint, samplePlot } from "./geometry";
import {
  ANCHORABLE_TYPES,
  elementAnchors,
  elementBindings,
  elementLabelCount,
  elementParts,
  elementRoles,
  elementTexts,
  splitTarget,
  visibilityByBeat,
} from "./inspect";
import {
  sampleScopes,
  toModelDefinition,
  withSceneValues,
  type ModelSource,
  type ScopeSample,
} from "./model-scope";
import { checkTex } from "./tex";
import { totalDurationMs } from "./timing";

export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6;

export const RULE_NAMES: Readonly<Record<RuleNumber, string>> = {
  1: "structure",
  2: "references",
  3: "model",
  4: "readability",
  5: "framing",
  6: "pedagogy",
};

export interface ValidationIssue {
  rule: RuleNumber;
  where: string;
  message: string;
}

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; rule: RuleNumber; issues: ValidationIssue[] };

export type ExplanationShape = "full" | "short";

export const PEDAGOGY = {
  full: { minScenes: 4, maxScenes: 7, minDurationMs: 45_000, maxDurationMs: 120_000 },
  short: { minScenes: 1, maxScenes: 3, minDurationMs: 0, maxDurationMs: 120_000 },
  requiredRoles: ["hook", "analogy", "mechanism", "example", "recap"] as readonly SceneRole[],
} as const;

export const MAX_PARAM_STEPS = 400;

const SLOT_CAPACITY: Partial<Record<SlotName, number>> = {
  text: 2,
  notes: 3,
  formula: 1,
  readout: 3,
};

export const NOTES_TEXT_CHARS = 70;
export const NOTES_ITEM_CHARS = 40;

const FRAME_TOLERANCE = 0.02;
const LABEL_COLLISION = { x: 0.03, y: 0.04 };
const MIN_VISIBLE_CURVE = 0.5;

function issue(rule: RuleNumber, where: string, message: string): ValidationIssue {
  return { rule, where, message };
}

function fromZod(error: z.ZodError, prefix: string): ValidationIssue[] {
  return error.issues.map((problem) => {
    const path = problem.path
      .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
      .join("");
    return issue(1, `${prefix}${path}`.replace(/^\./, ""), problem.message);
  });
}

function fail<T>(issues: ValidationIssue[]): ValidationResult<T> {
  return { ok: false, rule: (issues[0] as ValidationIssue).rule, issues };
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return [...twice];
}

type Sample = ScopeSample;

const at = (
  scene: Pick<Scene, "id">,
  element?: Pick<SceneElement, "id">,
  property?: string,
): string =>
  [`scene "${scene.id}"`, element ? `element "${element.id}"` : "", property ?? ""]
    .filter(Boolean)
    .join(" › ");

function structureIssues(scene: Scene): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const element of scene.elements) {
    const where = (property?: string): string => at(scene, element, property);
    switch (element.type) {
      case "vector": {
        const byEnd = element.to !== undefined;
        const byAim = element.toward !== undefined || element.length !== undefined;
        if (
          byEnd === byAim ||
          (byAim && (element.toward === undefined || element.length === undefined))
        ) {
          issues.push(issue(1, where(), 'give either "to", or both "toward" and "length"'));
        }
        break;
      }
      case "shape": {
        const required: Record<typeof element.kind, readonly (keyof typeof element)[]> = {
          circle: ["center", "radius"],
          rect: ["center", "width", "height"],
          polygon: ["points"],
          arc: ["center", "radius", "startDeg", "endDeg"],
        };
        const missing = required[element.kind].filter((key) => element[key] === undefined);
        if (missing.length > 0) {
          issues.push(
            issue(
              1,
              where(),
              `a ${element.kind} needs ${missing.map((k) => `"${String(k)}"`).join(", ")}`,
            ),
          );
        }
        break;
      }
      case "table":
        element.rows.forEach((row, i) => {
          if (row.length !== element.columns.length) {
            issues.push(
              issue(
                1,
                where(`rows[${i}]`),
                `has ${row.length} cells but the table has ${element.columns.length} columns`,
              ),
            );
          }
        });
        break;
      case "sim.array":
        if (element.algorithm.endsWith("search") && element.target === undefined) {
          issues.push(
            issue(1, where("target"), `"${element.algorithm}" needs a "target" value to look for`),
          );
        }
        break;
      default:
        break;
    }
    for (const text of elementTexts(element)) {
      if (text.isTex) {
        const problem = checkTex(text.text);
        if (problem) issues.push(issue(1, where(text.path), problem));
      } else {
        try {
          templateReferences(text.text);
        } catch (error) {
          issues.push(issue(1, where(text.path), (error as Error).message));
        }
      }
    }
  }
  return issues;
}

function outlineStructureIssues(outline: Outline): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const param of outline.params) {
    if ((param.max - param.min) / param.step > MAX_PARAM_STEPS) {
      issues.push(
        issue(
          1,
          `parameter "${param.id}" › step`,
          `too small: at most ${MAX_PARAM_STEPS} positions between min and max`,
        ),
      );
    }
  }
  if (outline.plan.key_rule.formula !== undefined) {
    const problem = checkTex(outline.plan.key_rule.formula);
    if (problem) issues.push(issue(1, "plan › key_rule › formula", problem));
  }
  return issues;
}

function quizStructureIssues(quiz: Quiz): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  quiz.questions.forEach((question, i) => {
    const ids = question.choices.map((choice) => choice.id);
    for (const id of duplicates(ids)) {
      issues.push(issue(1, `quiz › question ${i + 1}`, `choice id "${id}" is used more than once`));
    }
    if (!ids.includes(question.answer_id)) {
      issues.push(
        issue(
          1,
          `quiz › question ${i + 1} › answer_id`,
          `"${question.answer_id}" is not one of the choices`,
        ),
      );
    }
  });
  return issues;
}

function referenceIssues(scene: Scene, outline: ModelSource): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const modelIds = modelIdentifiers(toModelDefinition(outline));
  const paramIds = new Set(outline.params.map((param) => param.id));
  const lookup = elementLookup(scene);
  const allowedSlots: readonly SlotName[] = LAYOUT_SLOTS[scene.layout];

  for (const id of duplicates(scene.elements.map((element) => element.id))) {
    issues.push(issue(2, at(scene), `element id "${id}" is used more than once`));
  }
  for (const id of duplicates(scene.beats.map((beat) => beat.id))) {
    issues.push(issue(2, at(scene), `beat id "${id}" is used more than once`));
  }

  const bySlot = new Map<SlotName, SceneElement[]>();
  for (const element of scene.elements) {
    const where = (property?: string): string => at(scene, element, property);
    if (!allowedSlots.includes(element.slot)) {
      issues.push(
        issue(
          2,
          where("slot"),
          `layout "${scene.layout}" has no slot "${element.slot}"; its slots are ${allowedSlots.join(", ")}`,
        ),
      );
    } else if (!ELEMENT_SLOTS[element.type].includes(element.slot)) {
      issues.push(
        issue(
          2,
          where("slot"),
          `a "${element.type}" cannot go in "${element.slot}"; it goes in ${ELEMENT_SLOTS[element.type].join(" or ")}`,
        ),
      );
    }
    bySlot.set(element.slot, [...(bySlot.get(element.slot) ?? []), element]);

    if (WORLD_ELEMENT_TYPES.has(element.type) && !scene.world) {
      issues.push(
        issue(
          2,
          where(),
          `a "${element.type}" is positioned in the frame: the scene must declare "world"`,
        ),
      );
    }

    for (const anchor of elementAnchors(element)) {
      const target = lookup.get(anchor.ref);
      if (!target) {
        issues.push(issue(2, where(anchor.path), `no element "${anchor.ref}" in this scene`));
      } else if (target.id === element.id) {
        issues.push(issue(2, where(anchor.path), "an element cannot be attached to itself"));
      } else if (!ANCHORABLE_TYPES.has(target.type)) {
        issues.push(
          issue(
            2,
            where(anchor.path),
            `"${anchor.ref}" is a "${target.type}" and has no anchor point; attach to a point, an object or a shape, or give [x, y]`,
          ),
        );
      } else if (target.slot !== element.slot) {
        issues.push(
          issue(2, where(anchor.path), `"${anchor.ref}" is in another slot ("${target.slot}")`),
        );
      }
    }

    if (element.type === "area" || element.type === "tangent") {
      const plot = lookup.get(element.plot);
      if (!plot || plot.type !== "plot") {
        issues.push(
          issue(2, where("plot"), `"${element.plot}" is not a plot element of this scene`),
        );
      }
    }
    if (element.type === "readout" && !modelIds.has(element.value)) {
      issues.push(
        issue(
          2,
          where("value"),
          `"${element.value}" is not a parameter, constant or derived value; declared: ${[...modelIds].join(", ") || "none"}`,
        ),
      );
    }
    if (element.type === "relations") {
      const nodes = element.nodes.map((node) => node.id);
      for (const id of duplicates(nodes))
        issues.push(issue(2, where("nodes"), `node id "${id}" is used more than once`));
      element.edges.forEach((edge, i) => {
        for (const end of [edge.from, edge.to]) {
          if (!nodes.includes(end)) issues.push(issue(2, where(`edges[${i}]`), `no node "${end}"`));
        }
      });
    }
    if (element.type === "sim.flow") {
      const ids = [...element.inputs, ...element.outputs].map((branch) => branch.id);
      for (const id of duplicates(ids))
        issues.push(issue(2, where(), `branch id "${id}" is used more than once`));
    }
  }

  for (const [slot, elements] of bySlot) {
    const blocks = elements.filter((element) => BLOCK_ELEMENT_TYPES.has(element.type));
    const isFigureSlot = slot.startsWith("figure") || slot === "track";
    if (isFigureSlot && blocks.length > 0 && elements.length > 1) {
      issues.push(
        issue(
          2,
          at(scene),
          `"${(blocks[0] as SceneElement).id}" (${(blocks[0] as SceneElement).type}) fills the slot "${slot}" by itself; remove the other elements from that slot`,
        ),
      );
    }
  }

  const shown = new Set<string>();
  scene.beats.forEach((beat) => {
    const where = `${at(scene)} › beat "${beat.id}"`;
    const checkTarget = (target: string): SceneElement | undefined => {
      const { id, part } = splitTarget(target);
      const element = lookup.get(id);
      if (!element) {
        issues.push(issue(2, where, `target "${target}": no element "${id}" in this scene`));
        return undefined;
      }
      if (part !== undefined) {
        const parts = elementParts(element);
        if (!parts.includes(part)) {
          issues.push(
            issue(
              2,
              where,
              `target "${target}": "${id}" has no part "${part}"${parts.length ? `; its parts are ${parts.join(", ")}` : "; it has no parts"}`,
            ),
          );
        }
      }
      return element;
    };
    for (const action of beat.actions) {
      switch (action.do) {
        case "show":
          for (const target of action.targets) {
            if (checkTarget(target)) shown.add(splitTarget(target).id);
          }
          break;
        case "hide":
        case "highlight":
        case "focus":
          action.targets.forEach(checkTarget);
          break;
        case "move": {
          const element = checkTarget(action.target);
          if (element && element.type !== "point" && element.type !== "object") {
            issues.push(
              issue(
                2,
                where,
                `"move" works on a point or an object, and "${action.target}" is a "${element.type}"`,
              ),
            );
          }
          break;
        }
        case "sweep":
          if (!paramIds.has(action.param)) {
            issues.push(
              issue(
                2,
                where,
                `"sweep" needs a parameter, and "${action.param}" is not one; parameters: ${[...paramIds].join(", ") || "none"}`,
              ),
            );
          }
          break;
        case "play": {
          const element = checkTarget(action.target);
          if (element && !PLAYABLE_ELEMENT_TYPES.has(element.type)) {
            issues.push(
              issue(2, where, `"play" cannot drive "${action.target}" (a "${element.type}")`),
            );
          }
          break;
        }
      }
    }
  });
  for (const element of scene.elements) {
    if (!shown.has(element.id)) {
      issues.push(
        issue(
          2,
          at(scene, element),
          'is never made visible; add it to the targets of a "show" action, or remove it',
        ),
      );
    }
  }
  return issues;
}

function quizReferenceIssues(quiz: Quiz, scenes: readonly Scene[]): ValidationIssue[] {
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  return quiz.questions.flatMap((question, i) =>
    sceneIds.has(question.scene_id)
      ? []
      : [
          issue(
            2,
            `quiz › question ${i + 1} › scene_id`,
            `no scene "${question.scene_id}"; scenes are ${[...sceneIds].join(", ")}`,
          ),
        ],
  );
}

function safeReferences(text: string): ReturnType<typeof templateReferences> {
  try {
    return templateReferences(text);
  } catch {
    return [];
  }
}

function modelIssues(scene: Scene, outline: ModelSource): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const declared = modelIdentifiers(toModelDefinition(outline));
  const withX = new Set([...declared, "x"]);
  const samples = sampleScopes(outline);

  const checkBinding = (where: string, expr: string, allowX: boolean, allowTime: boolean): void => {
    const problems = checkExpression(expr, { allowed: allowX ? withX : declared, allowTime });
    if (problems.length > 0) {
      for (const problem of problems) issues.push(issue(3, where, problem));
      return;
    }
    if (allowX) return;
    for (const sample of samples) {
      const value = compile(expr).evaluate(sample.scope);
      if (!Number.isFinite(value)) {
        issues.push(issue(3, where, `"${expr}" is not a finite number with ${sample.label}`));
        return;
      }
    }
  };

  for (const element of scene.elements) {
    for (const binding of elementBindings(element)) {
      checkBinding(
        at(scene, element, binding.path),
        binding.expr,
        binding.allowX,
        binding.allowTime,
      );
    }
    for (const text of elementTexts(element)) {
      const references = safeReferences(text.text);
      for (const reference of references) {
        if (!declared.has(reference.id)) {
          issues.push(
            issue(
              3,
              at(scene, element, text.path),
              `${reference.raw} refers to an undeclared value; declared: ${[...declared].join(", ") || "none"}`,
            ),
          );
        }
      }
    }
  }
  for (const beat of scene.beats) {
    const where = `${at(scene)} › beat "${beat.id}"`;
    for (const action of beat.actions) {
      if (action.do === "sweep" && typeof action.to !== "number") {
        checkBinding(`${where} › sweep`, action.to.expr, false, false);
      }
      if (action.do === "move") {
        for (const coordinate of action.to) {
          if (typeof coordinate !== "number")
            checkBinding(`${where} › move`, coordinate.expr, false, false);
        }
      }
    }
  }
  return issues;
}

function readabilityIssues(scene: Scene): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const roles = new Set<string>();
  for (const element of scene.elements) {
    for (const role of elementRoles(element)) roles.add(role);
  }
  if (scene.beats.some((beat) => beat.actions.some((action) => action.do === "highlight")))
    roles.add("result");
  if (roles.size > sceneLimits.maxColourRoles) {
    issues.push(
      issue(
        4,
        at(scene),
        `uses ${roles.size} colour roles (${[...roles].join(", ")}); a scene uses at most ${sceneLimits.maxColourRoles} besides ink`,
      ),
    );
  }

  const visibility = visibilityByBeat(scene);
  let worstBeat = -1;
  let worstCount = 0;
  scene.beats.forEach((_, index) => {
    const count = scene.elements
      .filter((element) => visibility.get(element.id)?.has(index))
      .reduce((total, element) => total + elementLabelCount(element), 0);
    if (count > worstCount) {
      worstCount = count;
      worstBeat = index;
    }
  });
  if (worstCount > sceneLimits.maxVisibleLabels) {
    issues.push(
      issue(
        4,
        `${at(scene)} › beat "${(scene.beats[worstBeat] as Scene["beats"][number]).id}"`,
        `${worstCount} labels are visible together; at most ${sceneLimits.maxVisibleLabels}. Hide earlier elements or drop labels`,
      ),
    );
  }

  for (const element of scene.elements) {
    if (element.slot !== "notes") continue;
    if (element.type === "text" && element.text.length > NOTES_TEXT_CHARS) {
      issues.push(
        issue(
          4,
          at(scene, element, "text"),
          `has ${element.text.length} characters; a note beside a figure holds ${NOTES_TEXT_CHARS} at most`,
        ),
      );
    }
    if (element.type === "list" && element.items.some((item) => item.length > NOTES_ITEM_CHARS)) {
      issues.push(
        issue(
          4,
          at(scene, element, "items"),
          `an item of a list beside a figure holds ${NOTES_ITEM_CHARS} characters at most`,
        ),
      );
    }
  }

  const load = new Map<SlotName, number>();
  for (const element of scene.elements) load.set(element.slot, (load.get(element.slot) ?? 0) + 1);
  for (const [slot, count] of load) {
    const capacity = SLOT_CAPACITY[slot];
    if (capacity !== undefined && count > capacity) {
      issues.push(
        issue(4, at(scene), `slot "${slot}" holds ${count} elements; at most ${capacity}`),
      );
    }
  }
  return issues;
}

function framingIssues(scene: Scene, outline: ModelSource): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const samples = sampleScopes(outline);
  const defaults = (samples[0] as Sample).scope;

  for (const beat of scene.beats) {
    for (const action of beat.actions) {
      if (action.do !== "sweep") continue;
      const param = outline.params.find((candidate) => candidate.id === action.param);
      if (!param) continue;
      const target = resolve(action.to, defaults);
      if (target < param.min || target > param.max) {
        issues.push(
          issue(
            5,
            `${at(scene)} › beat "${beat.id}" › sweep`,
            `takes ${param.id} to ${target}, outside its range ${param.min}…${param.max}; widen the parameter or sweep less far`,
          ),
        );
      }
    }
  }

  const world = scene.world;
  if (!world) return issues;
  const width = world.x[1] - world.x[0];
  const height = world.y[1] - world.y[0];
  const inside = (point: readonly [number, number]): boolean =>
    point[0] >= world.x[0] - width * FRAME_TOLERANCE &&
    point[0] <= world.x[1] + width * FRAME_TOLERANCE &&
    point[1] >= world.y[0] - height * FRAME_TOLERANCE &&
    point[1] <= world.y[1] + height * FRAME_TOLERANCE;
  const describe = `x from ${world.x[0]} to ${world.x[1]}, y from ${world.y[0]} to ${world.y[1]}`;
  const lookup = elementLookup(scene);

  for (const element of scene.elements) {
    if (!WORLD_ELEMENT_TYPES.has(element.type)) continue;
    if (element.type === "plot") {
      const domain = plotDomain(element, world, defaults);
      if (!(domain[0] < domain[1])) {
        issues.push(
          issue(5, at(scene, element, "domain"), "the first bound must be lower than the second"),
        );
        continue;
      }
      const points = samplePlot(element.fn, domain, { ...defaults, t: 0 });
      const visible = points.filter((point) => Number.isFinite(point[1]) && inside(point)).length;
      if (visible / points.length < MIN_VISIBLE_CURVE) {
        issues.push(
          issue(
            5,
            at(scene, element, "fn"),
            `less than half of the curve is inside the frame (${describe}); change "world", the domain or the function`,
          ),
        );
      }
      continue;
    }
    for (const sample of samples) {
      const extent = elementExtent(element, lookup, sample.scope, world);
      const outside = extent.points.find(
        (point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !inside(point),
      );
      if (outside) {
        issues.push(
          issue(
            5,
            at(scene, element),
            `reaches (${round(outside[0])}, ${round(outside[1])}) with ${sample.label}, outside the frame (${describe}); widen "world" or scale the element`,
          ),
        );
        break;
      }
    }
  }

  for (const beat of scene.beats) {
    for (const action of beat.actions) {
      if (action.do !== "move") continue;
      const target = resolvePoint(action.to, defaults);
      if (!inside(target)) {
        issues.push(
          issue(
            5,
            `${at(scene)} › beat "${beat.id}" › move`,
            `sends "${action.target}" to (${round(target[0])}, ${round(target[1])}), outside the frame (${describe})`,
          ),
        );
      }
    }
  }

  const visibility = visibilityByBeat(scene);
  const labelled = scene.elements
    .filter((element) => WORLD_ELEMENT_TYPES.has(element.type))
    .map((element) => ({ element, label: elementExtent(element, lookup, defaults, world).label }))
    .filter(
      (entry): entry is { element: SceneElement; label: readonly [number, number] } =>
        entry.label !== null,
    );
  for (let i = 0; i < labelled.length; i += 1) {
    for (let j = i + 1; j < labelled.length; j += 1) {
      const a = labelled[i] as (typeof labelled)[number];
      const b = labelled[j] as (typeof labelled)[number];
      if (a.element.slot !== b.element.slot) continue;
      const together = [...(visibility.get(a.element.id) ?? [])].some((beat) =>
        visibility.get(b.element.id)?.has(beat),
      );
      if (!together) continue;
      if (
        Math.abs(a.label[0] - b.label[0]) < width * LABEL_COLLISION.x &&
        Math.abs(a.label[1] - b.label[1]) < height * LABEL_COLLISION.y
      ) {
        issues.push(
          issue(
            5,
            at(scene),
            `the labels of "${a.element.id}" and "${b.element.id}" overlap; move one of the elements or drop one label`,
          ),
        );
      }
    }
  }
  return issues;
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(4)) : value;
}

function planPedagogyIssues(outline: Outline, shape: ExplanationShape): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limits = PEDAGOGY[shape];
  const steps = outline.plan.steps;
  if (steps.length < limits.minScenes || steps.length > limits.maxScenes) {
    issues.push(
      issue(
        6,
        "plan › steps",
        `has ${steps.length} steps; expected ${limits.minScenes} to ${limits.maxScenes}`,
      ),
    );
  }
  if (shape === "full") {
    const roles = new Set(steps.map((step) => step.role));
    const missing = PEDAGOGY.requiredRoles.filter((role) => !roles.has(role));
    if (missing.length > 0) {
      issues.push(
        issue(
          6,
          "plan › steps",
          `no step has the role ${missing.map((role) => `"${role}"`).join(", ")}`,
        ),
      );
    }
    if (steps[0]?.role !== "hook")
      issues.push(issue(6, "plan › steps[0]", 'the first step must be the "hook"'));
    if (steps.at(-1)?.role !== "recap")
      issues.push(issue(6, "plan › steps", 'the last step must be the "recap"'));
  }
  return issues;
}

function scenePedagogyIssues(scene: Scene, outline: Pick<Outline, "plan">): ValidationIssue[] {
  const step = outline.plan.steps[scene.index];
  if (!step) {
    return [
      issue(
        6,
        at(scene, undefined, "index"),
        `the plan has ${outline.plan.steps.length} steps, so there is no scene ${scene.index}`,
      ),
    ];
  }
  if (step.role !== scene.role) {
    return [
      issue(
        6,
        at(scene, undefined, "role"),
        `is "${scene.role}" but step ${scene.index} of the plan is "${step.role}"`,
      ),
    ];
  }
  return [];
}

function documentPedagogyIssues(
  document: ExplanationDocument,
  shape: ExplanationShape,
  allowPartial: boolean,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limits = PEDAGOGY[shape];
  const scenes = document.scenes;
  for (const id of duplicates(scenes.map((scene) => scene.id))) {
    issues.push(issue(6, "scenes", `scene id "${id}" is used more than once`));
  }
  const indexes = scenes.map((scene) => scene.index);
  if (indexes.some((index, i) => i > 0 && index <= (indexes[i - 1] as number))) {
    issues.push(issue(6, "scenes", "scenes must be listed in increasing order of index"));
  }
  if (!allowPartial) {
    if (scenes.length !== document.plan.steps.length) {
      issues.push(
        issue(
          6,
          "scenes",
          `there are ${scenes.length} scenes for ${document.plan.steps.length} steps in the plan`,
        ),
      );
    }
    const duration = totalDurationMs(scenes);
    if (duration < limits.minDurationMs || duration > limits.maxDurationMs) {
      issues.push(
        issue(
          6,
          "scenes",
          `the explanation lasts about ${Math.round(duration / 1000)} s; expected ${limits.minDurationMs / 1000} to ${limits.maxDurationMs / 1000} s`,
        ),
      );
    }
  }
  return issues;
}

export interface OutlineOptions {
  shape?: ExplanationShape;
}

export function validateOutline(
  input: unknown,
  options: OutlineOptions = {},
): ValidationResult<Outline> {
  const parsed = OutlineSchema.safeParse(input);
  if (!parsed.success) return fail(fromZod(parsed.error, ""));
  const outline = parsed.data;

  const structure = outlineStructureIssues(outline);
  if (structure.length > 0) return fail(structure);

  const model = checkModel(toModelDefinition(outline)).map((message) => issue(3, "model", message));
  if (model.length > 0) return fail(model);

  const pedagogy = planPedagogyIssues(outline, options.shape ?? "full");
  if (pedagogy.length > 0) return fail(pedagogy);

  return { ok: true, value: outline };
}

function sceneModelIssues(scene: Scene, outline: ModelSource): ValidationIssue[] {
  if (scene.derived.length === 0) return [];
  const outlineIds = modelIdentifiers(toModelDefinition(outline));
  const own = new Set(scene.derived.map((derived) => derived.id));
  return checkModel(toModelDefinition(withSceneValues(outline, scene)))
    .filter(
      (message) => [...own].some((id) => message.includes(`"${id}"`)) || outlineIds.size === 0,
    )
    .map((message) => issue(3, `${at(scene)} › derived`, message));
}

export function validateScene(input: unknown, outline: Outline): ValidationResult<Scene> {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) return fail(fromZod(parsed.error, ""));
  const scene = parsed.data;
  const scoped = withSceneValues(outline, scene);

  const rules: (() => ValidationIssue[])[] = [
    () => structureIssues(scene),
    () => referenceIssues(scene, scoped),
    () => {
      const own = sceneModelIssues(scene, outline);
      return own.length > 0 ? own : modelIssues(scene, scoped);
    },
    () => readabilityIssues(scene),
    () => framingIssues(scene, scoped),
    () => scenePedagogyIssues(scene, outline),
  ];
  for (const rule of rules) {
    const issues = rule();
    if (issues.length > 0) return fail(issues);
  }
  return { ok: true, value: scene };
}

export interface DocumentOptions {
  shape?: ExplanationShape;
  allowPartial?: boolean;
}

export function validateDocument(
  input: unknown,
  options: DocumentOptions = {},
): ValidationResult<ExplanationDocument> {
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) return fail(fromZod(parsed.error, ""));
  const document = parsed.data;
  const shape = options.shape ?? "full";
  const { scenes, quiz } = document;

  const rules: (() => ValidationIssue[])[] = [
    () => [
      ...outlineStructureIssues(document),
      ...scenes.flatMap(structureIssues),
      ...(quiz ? quizStructureIssues(quiz) : []),
    ],
    () => [
      ...scenes.flatMap((scene) => referenceIssues(scene, withSceneValues(document, scene))),
      ...(quiz ? quizReferenceIssues(quiz, scenes) : []),
    ],
    () => {
      const model = checkModel(toModelDefinition(document)).map((message) =>
        issue(3, "model", message),
      );
      if (model.length > 0) return model;
      return scenes.flatMap((scene) => {
        const own = sceneModelIssues(scene, document);
        return own.length > 0 ? own : modelIssues(scene, withSceneValues(document, scene));
      });
    },
    () => scenes.flatMap(readabilityIssues),
    () => scenes.flatMap((scene) => framingIssues(scene, withSceneValues(document, scene))),
    () => [
      ...planPedagogyIssues(document, shape),
      ...scenes.flatMap((scene) => scenePedagogyIssues(scene, document)),
      ...documentPedagogyIssues(document, shape, options.allowPartial ?? false),
    ],
  ];
  for (const rule of rules) {
    const issues = rule();
    if (issues.length > 0) return fail(issues);
  }
  return { ok: true, value: document };
}

export function formatIssues(issues: readonly ValidationIssue[], limit = 12): string {
  if (issues.length === 0) return "";
  const rule = (issues[0] as ValidationIssue).rule;
  const lines = issues.slice(0, limit).map((problem) => `- ${problem.where}: ${problem.message}`);
  const more =
    issues.length > limit ? `\n- … and ${issues.length - limit} more of the same kind` : "";
  return `Rule ${rule} (${RULE_NAMES[rule]}) failed:\n${lines.join("\n")}${more}`;
}
