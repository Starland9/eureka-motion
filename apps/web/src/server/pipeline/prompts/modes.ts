import { LEVELS, type ExplanationShape, type Level, type Outline, type Scene } from "scene";
import { z } from "zod";
import { buildOutlinePrompt, OUTLINE_MARKER } from "./outline";
import { buildScenePrompt, type SceneInput } from "./scene";
import {
  LANGUAGE_NAME,
  LEVEL_GUIDE,
  quoteStudent,
  STUDENT_TEXT_RULE,
  type Audience,
  type Prompt,
} from "./shared";

export const DERIVED_MODES = ["another_analogy", "simpler", "zoom", "followup"] as const;
export type DerivedMode = (typeof DERIVED_MODES)[number];

export type Analogy = Outline["plan"]["analogy"];

export const MODE_SHAPE: Readonly<Record<DerivedMode, ExplanationShape>> = {
  another_analogy: "full",
  simpler: "full",
  zoom: "short",
  followup: "short",
};

export interface ParentContext {
  title: string;
  slug: string;
  level: Level;
  outline: Outline;
  scenes: readonly Scene[];
}

export type ModeTask =
  | { mode: "another_analogy" | "simpler"; parent: ParentContext; analogies: readonly Analogy[] }
  | { mode: "zoom"; parent: ParentContext; focus: string }
  | { mode: "followup"; parent: ParentContext; question: string };

export const FOLLOWUP_CHECK_MARKER = "FOLLOWUP CHECK";

export function modeMarker(mode: DerivedMode): string {
  return `MODE ${mode}`;
}

const rank = (level: Level): number => LEVELS.indexOf(level);

export function boundLevel(requested: Level, parent: Level): Level {
  return rank(requested) <= rank(parent) ? requested : parent;
}

export function levelBelow(level: Level): Level | null {
  return LEVELS[rank(level) - 1] ?? null;
}

export function modeLevel(mode: DerivedMode, requested: Level, parent: Level): Level {
  const bounded = boundLevel(requested, parent);
  return mode === "simpler" ? (levelBelow(bounded) ?? bounded) : bounded;
}

export const FollowupCheckSchema = z.object({
  related: z.boolean(),
  title: z
    .string()
    .default("")
    .transform((text) => text.trim().slice(0, 60)),
  detected_language: z.enum(["fr", "en", "other"]).default("other"),
});
export type FollowupCheck = z.infer<typeof FollowupCheckSchema>;

const ANOTHER_ANALOGY_RULES = `Mode: another analogy
The student watched the explanation outlined in the message and still did not understand. Write a NEW outline of the same concept, at the same level, that changes the angle with a different analogy.
- plan.analogy: an everyday situation that differs from every analogy listed in the message. A new name for the same image does not count (a lamp, a candle and a torch are one analogy), nor does a variant of it. It must still behave like the concept on the point that matters.
- The whole explanation follows the new analogy: a new hook and steps built on it. Do not copy the steps of the previous outline.
- Keep what was correct: the same key rule, and the same parameters and model (same ids, symbols and units) unless the new analogy needs another quantity.`;

function simplerRules(previous: Level, level: Level): string {
  const audience =
    previous === level
      ? "The previous version was already written for the audience stated above: go simpler still, with the words of primary school."
      : `The previous version was written for this audience: ${LEVEL_GUIDE[previous]} Use the vocabulary and the prerequisites of the audience stated above instead.`;
  return `Mode: simpler
The student watched the explanation outlined in the message and found it too hard. Write a SIMPLER outline of the same concept, for the audience stated above.
- ${audience}
- Fewer notions: fewer prerequisites than the previous outline, 2 parameters at most, no technical term other than the name of the concept, and the formula only if it cannot be avoided.
- A lighter sequence: 4 or 5 steps, one small idea per step, the most concrete example possible, short sentences.
- The analogy may stay if it is the simplest one available; otherwise choose a simpler one.
- Simpler never means false: the key rule stays true, as the standard simplification of that level.`;
}

const ZOOM_RULES = `Mode: zoom on one step
The student got stuck on one step of the explanation outlined in the message; that step and its scene are given. Write a short outline that explains THAT step only, more slowly, broken down into smaller steps.
- 2 or 3 steps (1 at least), each one isolating a part of the focused step that went too fast: a cause, an intermediate state, a quantity that changes, a detail of the figure.
- Do not explain again what the other steps of the previous outline cover, and do not go beyond the focused step: start from what the student has just seen.
- objective: what the student will understand of that step. key_rule: the rule of that step, stated more slowly.
- Same objects and notation: keep the parameters (same id, symbol and unit), the constants and the derived values of the previous explanation that the step uses, and its analogy when the step relies on it.`;

const FOLLOWUP_RULES = `Mode: follow-up question
The student watched the explanation outlined in the message and asks a follow-up question about it, given between <student_text> tags. Write a short outline that answers it and continues that explanation.
- 1 to 3 steps that answer the question asked, nothing more. Do not explain again what the previous explanation already showed: build on it.
- Same world: keep every parameter of the previous explanation with the same id, symbol and unit (widen a range only if the question needs it, for instance to double a distance), the constants with the same ids and values, and its derived values with the same ids when they compute what you need. Add a parameter or a derived value only for what the question brings, and declare the values the answer compares (for instance the result at the doubled quantity).
- Same objects: the steps show the objects of the previous scenes, listed in the message, and each "visual" names them as they were drawn.
- plan.analogy: keep the analogy of the previous explanation unless the question calls for another one.
- key_rule: the answer in one sentence; its formula only if the answer needs it.
- If the question rests on a misconception, the answer corrects it.`;

const CONTINUITY_RULES = `Continuity
This scene belongs to a short answer that continues an explanation the student has just watched; what they saw is given in the message. Draw what appears again the same way: the same element ids, pictograms ("kind"), labels, simulations and colour roles, and the same parameters and symbols. Never give a new name to something the student has already seen.`;

function modeRules(task: ModeTask, level: Level): string {
  switch (task.mode) {
    case "another_analogy":
      return ANOTHER_ANALOGY_RULES;
    case "simpler":
      return simplerRules(task.parent.level, level);
    case "zoom":
      return ZOOM_RULES;
    case "followup":
      return FOLLOWUP_RULES;
  }
}

function silent(scene: Scene): Scene {
  return {
    ...scene,
    beats: scene.beats.map((beat) => {
      const copy = { ...beat };
      delete copy.audio;
      return copy;
    }),
  };
}

function elementNote(element: Scene["elements"][number]): string {
  const parts: string[] = [element.id, element.type];
  if ("kind" in element && typeof element.kind === "string") parts.push(element.kind);
  if ("label" in element && typeof element.label === "string") {
    parts.push(JSON.stringify(element.label));
  }
  return parts.join(" ");
}

function sceneLine(scene: Scene): string {
  const objects = scene.elements.map(elementNote).join("; ");
  return `- ${scene.id} (${scene.role}) ${JSON.stringify(scene.title)}: ${objects}`;
}

function focusOf(parent: ParentContext, sceneId: string) {
  const scene = parent.scenes.find((candidate) => candidate.id === sceneId);
  const step = scene ? parent.outline.plan.steps[scene.index] : undefined;
  if (!scene || !step) throw new Error(`The previous explanation has no scene ${sceneId}`);
  return { scene, step };
}

function parentLines(parent: ParentContext): string[] {
  return [
    `Concept name: ${parent.title} (${parent.slug})`,
    `Previous outline, written for ${parent.level}:\n${JSON.stringify(parent.outline)}`,
  ];
}

function taskLines(task: ModeTask): string[] {
  const lines = parentLines(task.parent);
  switch (task.mode) {
    case "another_analogy":
    case "simpler": {
      const header =
        task.mode === "another_analogy"
          ? "Analogies already shown in this session, none of which may be used again:"
          : "Analogies already shown in this session:";
      lines.push([header, ...task.analogies.map((a) => `- ${a.name}: ${a.mapping}`)].join("\n"));
      break;
    }
    case "zoom": {
      const { scene, step } = focusOf(task.parent, task.focus);
      const total = task.parent.outline.plan.steps.length;
      lines.push(
        `Step the student is stuck on: step ${scene.index + 1} of ${total}, scene "${scene.id}":\n${JSON.stringify(step)}`,
        `That scene, as the student saw it:\n${JSON.stringify(silent(scene))}`,
      );
      break;
    }
    case "followup":
      lines.push(
        `Scenes the student watched, with their objects:\n${task.parent.scenes.map(sceneLine).join("\n")}`,
        `The student's follow-up question:\n${quoteStudent(task.question)}`,
      );
      break;
  }
  return lines;
}

export interface ModeOutlineInput extends Audience {
  task: ModeTask;
  extra?: string | undefined;
}

export function buildModeOutlinePrompt(input: ModeOutlineInput): Prompt {
  const { task } = input;
  const base = buildOutlinePrompt({
    question: "",
    language: input.language,
    level: input.level,
    shape: MODE_SHAPE[task.mode],
  });
  const lines = [OUTLINE_MARKER, modeMarker(task.mode), ...taskLines(task)];
  if (input.extra) lines.push(input.extra);
  return {
    system: `${base.system}\n\n${modeRules(task, input.level)}`,
    messages: [{ role: "user", content: lines.join("\n") }],
  };
}

export interface ModeSceneInput extends SceneInput {
  task: ModeTask;
}

function previousScenes(task: ModeTask): string | null {
  if (task.mode === "zoom") {
    const { scene } = focusOf(task.parent, task.focus);
    return `Scene the student got stuck on, as they saw it:\n${JSON.stringify(silent(scene))}`;
  }
  if (task.mode === "followup") {
    const drawn = task.parent.scenes.map(({ id, role, title, layout, world, elements }) =>
      JSON.stringify({ id, role, title, layout, world, elements }),
    );
    return `Scenes the student watched, to reuse what appears again:\n${drawn.join("\n")}`;
  }
  return null;
}

export function buildModeScenePrompt(input: ModeSceneInput): Prompt {
  const base = buildScenePrompt(input);
  const context = previousScenes(input.task);
  if (context === null) return base;
  return {
    system: `${base.system}\n\n${CONTINUITY_RULES}`,
    messages: base.messages.map((message) => ({
      ...message,
      content: `${message.content}\n${context}`,
    })),
  };
}

export interface FollowupCheckInput extends Audience {
  parent: ParentContext;
  question: string;
}

export function buildFollowupCheckPrompt(input: FollowupCheckInput): Prompt {
  const language = LANGUAGE_NAME[input.language];
  const system = `You are the front desk of Eureka Motion. A student has just watched an animated explanation and typed a follow-up question under it. You decide whether that question belongs to this explanation. Reply with one JSON object.

${STUDENT_TEXT_RULE}

Decision
- related: true when the question is about the concept of the explanation or about something it shows: what happens if a quantity changes ("what if the distance doubles?"), a particular case, a cause, a consequence, an example, a step the student did not follow, or a neighbouring notion that this explanation is the natural place to answer. A short or informal question is still related ("and the Moon?", "why squared?").
- related: false when it is about another concept, is not a question about a school concept, or asks for something other than an explanation. It will be handled as a new question, so never stretch the explanation to cover it.

Fields
- title (only when related, otherwise ""): a heading for the answer in ${language}, 60 characters at most, worded like the question ("Et si la distance double ?").
- detected_language: the language the student wrote in: "fr", "en" or "other".

JSON shape
{ "related": true, "title": "", "detected_language": "fr" }`;

  const { plan, params } = input.parent.outline;
  const lines = [
    FOLLOWUP_CHECK_MARKER,
    `Concept name: ${input.parent.title} (${input.parent.slug})`,
    `Level: ${input.level}`,
    `Objective of the explanation: ${plan.objective}`,
    `Key rule: ${plan.key_rule.statement}`,
    `Steps:\n${plan.steps.map((step) => `- ${step.role}: ${step.intent}`).join("\n")}`,
  ];
  if (params.length > 0) {
    lines.push(`Quantities: ${params.map((p) => `${p.symbol} (${p.label})`).join(", ")}`);
  }
  lines.push(quoteStudent(input.question));
  return { system, messages: [{ role: "user", content: lines.join("\n") }] };
}

const FUNCTION_WORDS = new Set(
  (
    "le la les un une des du de au aux en et ou qui que qu on dont sur sous dans pour par avec " +
    "sans sa ses leur leurs ce cet cette ces deux trois quatre comme the an of in on at to " +
    "for with and or that which who its their from as by two three four like"
  ).split(" "),
);

function contentWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !FUNCTION_WORDS.has(word))
    .map((word) => (word.length > 3 ? word.replace(/[sx]$/, "") : word));
}

// Names open on the image ("La lampe qui…"); the rest often restates the law they share.
export function sameAnalogy(a: string, b: string): boolean {
  const left = contentWords(a);
  const right = contentWords(b);
  const [leftHead, rightHead] = [left[0], right[0]];
  if (leftHead === undefined || rightHead === undefined) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return right.includes(leftHead) || left.includes(rightHead);
}

function analogyIssues(analogies: readonly Analogy[], outline: Outline): string[] {
  const name = outline.plan.analogy.name;
  const repeated = analogies.find((analogy) => sameAnalogy(analogy.name, name));
  if (!repeated) return [];
  const shown = analogies.map((analogy) => `"${analogy.name}"`).join(", ");
  return [
    `plan.analogy: "${name}" repeats the analogy "${repeated.name}" already shown in this session. Choose another everyday situation, different from all of: ${shown}.`,
  ];
}

const FULL_MIN_STEPS = 4;

function lighterIssues(previous: Outline, outline: Outline): string[] {
  if (previous.plan.steps.length < FULL_MIN_STEPS) return [];
  const issues: string[] = [];
  const compare = (where: string, now: number, before: number, what: string): void => {
    if (now > before) {
      issues.push(
        `${where}: ${now} ${what}, the previous explanation had ${before}; a simpler one has fewer, or as many at most.`,
      );
    }
  };
  compare("plan.steps", outline.plan.steps.length, previous.plan.steps.length, "steps");
  compare(
    "plan.prerequisites",
    outline.plan.prerequisites.length,
    previous.plan.prerequisites.length,
    "prerequisites",
  );
  compare("params", outline.params.length, previous.params.length, "parameters");
  return issues;
}

const sameText = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? "").normalize("NFC").trim() === (b ?? "").normalize("NFC").trim();

const sameValue = (a: number, b: number): boolean =>
  a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));

function notationIssues(previous: Outline, outline: Outline, keepAll: boolean): string[] {
  const issues: string[] = [];
  const unit = (text: string): string => (text === "" ? "no unit" : `"${text}"`);

  for (const param of outline.params) {
    const same = previous.params.find((candidate) => candidate.id === param.id);
    if (same) {
      if (!sameText(same.symbol, param.symbol) || !sameText(same.unit, param.unit)) {
        issues.push(
          `params › ${param.id}: the previous explanation writes it "${same.symbol}" with ${unit(same.unit)}; keep that symbol and that unit.`,
        );
      }
      continue;
    }
    const homonym = previous.params.find((candidate) => sameText(candidate.symbol, param.symbol));
    if (homonym) {
      issues.push(
        `params › ${param.id}: "${param.symbol}" is the parameter "${homonym.id}" of the previous explanation; keep the id "${homonym.id}".`,
      );
    }
  }

  for (const constant of outline.model.constants) {
    const same = previous.model.constants.find((candidate) => candidate.id === constant.id);
    if (same) {
      if (!sameValue(same.value, constant.value) || !sameText(same.unit, constant.unit)) {
        issues.push(
          `model.constants › ${constant.id}: the previous explanation uses ${same.value} with ${unit(same.unit)}; keep that value and that unit.`,
        );
      }
      continue;
    }
    const homonym =
      constant.symbol === undefined
        ? undefined
        : previous.model.constants.find((candidate) => sameText(candidate.symbol, constant.symbol));
    if (homonym) {
      issues.push(
        `model.constants › ${constant.id}: "${constant.symbol}" is the constant "${homonym.id}" of the previous explanation; keep the id "${homonym.id}".`,
      );
    }
  }

  if (keepAll) {
    const kept = new Set(outline.params.map((param) => param.id));
    for (const param of previous.params) {
      if (!kept.has(param.id)) {
        issues.push(
          `params: keep the parameter "${param.id}" (${param.symbol}, ${unit(param.unit)}) of the previous explanation; the answer continues it with the same sliders.`,
        );
      }
    }
  }
  return issues;
}

export function checkModeOutline(task: ModeTask, outline: Outline): string | null {
  const previous = task.parent.outline;
  const issues =
    task.mode === "another_analogy"
      ? analogyIssues(task.analogies, outline)
      : task.mode === "simpler"
        ? lighterIssues(previous, outline)
        : notationIssues(previous, outline, task.mode === "followup");
  if (issues.length === 0) return null;
  return `The outline does not fit this mode:\n${issues.map((issue) => `- ${issue}`).join("\n")}`;
}
