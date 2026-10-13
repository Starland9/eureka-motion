import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ELEMENT_SLOTS,
  ELEMENT_TYPES,
  formatIssues,
  validateDocument,
  validateOutline,
  validateScene,
  type ValidationResult,
} from "../../src/schema";

const REFERENCE = fileURLToPath(
  new URL("../../../../content/reference/physics.universal-gravitation.fr.json", import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documents are mutated freely to build invalid cases
type Loose = any;
const reference: Loose = JSON.parse(readFileSync(REFERENCE, "utf8"));

const doc = (): Loose => structuredClone(reference.payload);
const scene = (d: Loose, id: string): Loose => d.scenes.find((s: Loose) => s.id === id);
const el = (d: Loose, sceneId: string, id: string): Loose =>
  scene(d, sceneId).elements.find((e: Loose) => e.id === id);
const beat = (d: Loose, sceneId: string, id: string): Loose =>
  scene(d, sceneId).beats.find((b: Loose) => b.id === id);
const showAll = (d: Loose, sceneId: string, ...ids: string[]): void => {
  beat(d, sceneId, "b1").actions.push({ do: "show", targets: ids });
};

function expectFailure(result: ValidationResult<unknown>, rule: number, fragment: string): void {
  if (result.ok) throw new Error(`expected rule ${rule} to fail, but the document is valid`);
  const text = formatIssues(result.issues);
  expect(text, text).toContain(fragment);
  expect(result.rule, text).toBe(rule);
}

const breaking = (rule: number, fragment: string, mutate: (d: Loose) => void) => (): void => {
  const d = doc();
  mutate(d);
  expectFailure(validateDocument(d), rule, fragment);
};

describe("a valid document", () => {
  it("passes the six rules", () => {
    const result = validateDocument(doc());
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("passes as an outline followed by scenes, the way the pipeline validates", () => {
    const d = doc();
    const outline = validateOutline({ plan: d.plan, params: d.params, model: d.model });
    if (!outline.ok) throw new Error(formatIssues(outline.issues));
    for (const s of d.scenes) {
      const result = validateScene(s, outline.value);
      expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
    }
  });

  it("fills in defaults", () => {
    const d = doc();
    delete beat(d, "s6", "b2").actions;
    const result = validateDocument(d);
    if (!result.ok) throw new Error(formatIssues(result.issues));
    expect(result.value.scenes[5]?.beats[1]?.actions).toEqual([]);
  });
});

describe("the schema covers every primitive", () => {
  it("declares slots for each element type", () => {
    expect(ELEMENT_TYPES).toHaveLength(32);
    for (const type of ELEMENT_TYPES) expect(ELEMENT_SLOTS[type].length).toBeGreaterThan(0);
  });
});

describe("rule 1 — structure", () => {
  it(
    "rejects an unknown document version",
    breaking(1, "version", (d) => (d.version = 2)),
  );
  it(
    "rejects a missing required field",
    breaking(1, "title", (d) => delete scene(d, "s1").title),
  );
  it("ignores a property the primitive does not have", () => {
    const d = doc();
    el(d, "s1", "apple").colour = "red";
    const result = validateDocument(d);
    if (!result.ok) throw new Error(formatIssues(result.issues));
    expect(
      result.value.scenes[0]?.elements.find((element) => element.id === "apple"),
    ).not.toHaveProperty("colour");
  });

  it("accepts a bare expression where a number is expected", () => {
    const d = doc();
    el(d, "s3", "sys").distance = "r";
    el(d, "s1", "apple").at = ["0", 1.5];
    const result = validateDocument(d);
    if (!result.ok) throw new Error(formatIssues(result.issues));
    const sys = result.value.scenes[2]?.elements.find((element) => element.id === "sys");
    expect(sys).toMatchObject({ distance: { expr: "r" } });
  });
  it(
    "rejects an unknown primitive",
    breaking(1, "type", (d) => (el(d, "s1", "apple").type = "sprite")),
  );
  it(
    "rejects a pictogram outside the library",
    breaking(1, "kind", (d) => (el(d, "s1", "apple").kind = "dragon")),
  );
  it(
    "rejects a narration longer than 200 characters",
    breaking(1, "narration", (d) => (beat(d, "s1", "b1").narration = "mot ".repeat(60))),
  );
  it(
    "rejects a title longer than 60 characters",
    breaking(1, "title", (d) => (scene(d, "s1").title = "x".repeat(61))),
  );
  it(
    "rejects more than four parameters",
    breaking(1, "params", (d) => {
      for (const id of ["a", "b"]) d.params.push({ ...d.params[0], id });
    }),
  );
  it(
    "rejects a vector that gives both an end point and a direction",
    breaking(1, 'either "to"', (d) => (el(d, "s1", "moon_pull").to = [0, 0])),
  );
  it(
    "rejects a vector with a direction but no length",
    breaking(1, 'either "to"', (d) => delete el(d, "s1", "moon_pull").length),
  );
  it(
    "rejects a shape without the fields of its kind",
    breaking(1, 'a circle needs "radius"', (d) => {
      scene(d, "s1").elements.push({
        id: "disc",
        slot: "figure_a",
        type: "shape",
        kind: "circle",
        center: [0, 0],
      });
      showAll(d, "s1", "disc");
    }),
  );
  it(
    "rejects a table row that does not match its columns",
    breaking(1, "cells", (d) => {
      scene(d, "s2").elements.push({
        id: "tab",
        slot: "notes",
        type: "table",
        columns: ["Distance", "Lumière"],
        rows: [["1 m", "1", "trop"]],
      });
      showAll(d, "s2", "tab");
    }),
  );
  it(
    "rejects a formula that sets its own colours",
    breaking(
      1,
      "\\textcolor is not allowed",
      (d) => (el(d, "s4", "law").tex = "\\textcolor{red}{F} = ma"),
    ),
  );
  it(
    "rejects a formula that links out",
    breaking(
      1,
      "\\href is not allowed",
      (d) => (el(d, "s4", "law").tex = "\\href{https://x.test}{F}"),
    ),
  );
  it(
    "rejects a formula that redefines macros",
    breaking(1, "\\def is not allowed", (d) => (el(d, "s4", "law").tex = "\\def\\q{x} F")),
  );
  it(
    "rejects a formula KaTeX cannot parse",
    breaking(1, "not valid KaTeX", (d) => (el(d, "s4", "law").tex = "\\frac{1}{")),
  );
  it(
    "rejects a malformed interpolation",
    breaking(
      1,
      "Malformed interpolation",
      (d) => (el(d, "s5", "value").text = "Force : {{F * 2}} N"),
    ),
  );
  it(
    "rejects a quiz answer that is not one of the choices",
    breaking(1, "is not one of the choices", (d) => (d.quiz.questions[0].answer_id = "z")),
  );
  it(
    "rejects a parameter with too many slider positions",
    breaking(1, "at most 400 positions", (d) => (d.params[2].step = 1)),
  );
  it(
    "rejects a search algorithm without a target",
    breaking(1, 'needs a "target"', (d) => {
      scene(d, "s2").elements = [
        {
          id: "arr",
          slot: "figure",
          type: "sim.array",
          values: [1, 2, 3],
          algorithm: "binary-search",
        },
      ];
      scene(d, "s2").beats = [
        { id: "b1", narration: "On cherche.", actions: [{ do: "show", targets: ["arr"] }] },
      ];
    }),
  );
});

describe("rule 2 — references", () => {
  it(
    "rejects a duplicated element id",
    breaking(2, 'element id "apple" is used more than once', (d) =>
      scene(d, "s1").elements.push({ ...el(d, "s1", "apple") }),
    ),
  );
  it(
    "rejects a duplicated beat id",
    breaking(2, 'beat id "b1" is used more than once', (d) => (beat(d, "s1", "b2").id = "b1")),
  );
  it(
    "rejects a slot the layout does not have",
    breaking(
      2,
      'layout "figure-notes" has no slot "formula"',
      (d) => (el(d, "s2", "twice").slot = "formula"),
    ),
  );
  it(
    "rejects a primitive placed in a slot it cannot occupy",
    breaking(2, 'a "text" cannot go in "figure"', (d) => (el(d, "s3", "rule").slot = "figure")),
  );
  it(
    "rejects a positioned element in a scene without a frame",
    breaking(2, 'must declare "world"', (d) => delete scene(d, "s1").world),
  );
  it(
    "rejects an attachment to an element that does not exist",
    breaking(2, 'no element "nope"', (d) => (el(d, "s1", "apple_pull").from = "nope")),
  );
  it(
    "rejects an attachment to an element without an anchor point",
    breaking(2, "has no anchor point", (d) => (el(d, "s1", "apple_pull").from = "ground")),
  );
  it(
    "rejects an attachment across slots",
    breaking(2, "is in another slot", (d) => (el(d, "s1", "apple_pull").from = "moon")),
  );
  it(
    "rejects an action aimed at a missing element",
    breaking(2, 'no element "ghost"', (d) =>
      beat(d, "s1", "b1").actions.push({ do: "hide", targets: ["ghost"] }),
    ),
  );
  it(
    "rejects an action aimed at a part the element does not have, and lists the parts",
    breaking(2, "its parts are body_a, body_b, force_a, force_b, distance", (d) =>
      beat(d, "s3", "b1").actions.push({ do: "highlight", targets: ["sys.wings"] }),
    ),
  );
  it(
    "rejects an element that is never shown",
    breaking(2, "is never made visible", (d) => (beat(d, "s2", "b3").actions = [])),
  );
  it(
    "rejects a readout of an undeclared value",
    breaking(2, '"weight" is not a parameter', (d) => (el(d, "s3", "force_now").value = "weight")),
  );
  it(
    "rejects a sweep of something that is not a parameter",
    breaking(2, '"F" is not one', (d) => (beat(d, "s3", "b3").actions[0].param = "F")),
  );
  it(
    "rejects play on an element that has no time",
    breaking(2, '"play" cannot drive "light"', (d) =>
      beat(d, "s2", "b1").actions.push({ do: "play", target: "light", to: 2 }),
    ),
  );
  it(
    "rejects move on something that is not a point or an object",
    breaking(2, '"move" works on a point or an object', (d) =>
      beat(d, "s1", "b1").actions.push({ do: "move", target: "ground", to: [0, 0] }),
    ),
  );
  it(
    "rejects another element sharing the slot of a simulation",
    breaking(2, "fills the slot", (d) => {
      scene(d, "s3").world = { x: [-5, 5], y: [-3, 3] };
      scene(d, "s3").elements.push({ id: "dot", slot: "figure", type: "point", at: [0, 0] });
      showAll(d, "s3", "dot");
    }),
  );
  it(
    "rejects an area that points at something other than a plot",
    breaking(2, "is not a plot element", (d) => {
      scene(d, "s1").elements.push({
        id: "under",
        slot: "figure_a",
        type: "area",
        plot: "apple",
        from: 0,
        to: 1,
      });
      showAll(d, "s1", "under");
    }),
  );
  it(
    "rejects a relation between unknown nodes",
    breaking(2, 'no node "c"', (d) => {
      scene(d, "s2").elements[0] = {
        id: "light",
        slot: "figure",
        type: "relations",
        nodes: [
          { id: "a", label: "Masse" },
          { id: "b", label: "Force" },
        ],
        edges: [{ from: "a", to: "c" }],
      };
    }),
  );
  it(
    "rejects a quiz question about a scene that does not exist",
    breaking(2, 'no scene "s9"', (d) => (d.quiz.questions[0].scene_id = "s9")),
  );
});

describe("rule 3 — model", () => {
  it(
    "rejects a binding that reads an undeclared name",
    breaking(3, 'unknown name "radius"', (d) => (el(d, "s3", "sys").distance = { expr: "radius" })),
  );
  it(
    "rejects a binding with a syntax error",
    breaking(3, "end of expression", (d) => (el(d, "s3", "sys").distance = { expr: "r *" })),
  );
  it(
    "rejects a binding that calls an unknown function",
    breaking(
      3,
      'Unknown function "eval"',
      (d) => (el(d, "s3", "sys").distance = { expr: "eval(r)" }),
    ),
  );
  it(
    "rejects time outside a temporal property",
    breaking(3, 'time "t" is not allowed', (d) => (el(d, "s1", "apple").at = [{ expr: "t" }, 1.5])),
  );
  it(
    "rejects a text that interpolates an undeclared value",
    breaking(
      3,
      "{{mass}} refers to an undeclared value",
      (d) => (el(d, "s5", "value").text = "Masse : {{mass}} kg"),
    ),
  );
  it(
    "rejects a derived value that reads a name declared after it",
    breaking(3, 'unknown name "F_2r"', (d) => (d.model.derived[0].expr = "F_2r * 4")),
  );
  it(
    "rejects a derived value that is not finite at a parameter bound",
    breaking(3, "is not a finite number when", (d) => {
      d.params[2].min = 0;
      d.params[2].step = 1e7;
    }),
  );
  it(
    "rejects a reserved parameter name",
    breaking(3, "this name is reserved", (d) => (d.params[0].id = "pi")),
  );
  it(
    "rejects a default outside the range of its parameter",
    breaking(3, "default must lie between min and max", (d) => (d.params[2].default = 9e9)),
  );
  it(
    "rejects a sweep target that reads an undeclared name",
    breaking(3, 'unknown name "far"', (d) => (beat(d, "s3", "b3").actions[0].to = { expr: "far" })),
  );
  it(
    "rejects a binding that is not finite for the default values",
    breaking(
      3,
      "is not a finite number with the default values",
      (d) => (el(d, "s1", "apple").size = { expr: "1 / (r - r)" }),
    ),
  );
});

describe("values declared by a scene", () => {
  it("lets a scene compute and show a value the outline does not provide", () => {
    const d = doc();
    scene(d, "s5").derived = [
      { id: "F_half", expr: "F / 2", unit: "N", label: "Moitié", format: "sci:2" },
    ];
    el(d, "s5", "value").text = "Moitié de la force : {{F_half|sci:2}} N.";
    const result = validateDocument(d);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it(
    "keeps those values private to their scene",
    breaking(3, "{{F_half}} refers to an undeclared value", (d) => {
      scene(d, "s5").derived = [{ id: "F_half", expr: "F / 2", unit: "N", label: "Moitié" }];
      el(d, "s3", "rule").text = "Moitié : {{F_half}}";
    }),
  );

  it(
    "rejects a scene value that redeclares a value of the outline",
    breaking(3, "declared more than once", (d) => {
      scene(d, "s5").derived = [{ id: "F", expr: "r", unit: "", label: "x" }];
    }),
  );

  it(
    "rejects a scene value that reads an undeclared name",
    breaking(3, 'unknown name "nope"', (d) => {
      scene(d, "s5").derived = [{ id: "x1", expr: "nope * 2", unit: "", label: "x" }];
    }),
  );
});

describe("rule 4 — readability", () => {
  it(
    "rejects more than three colour roles in a scene",
    breaking(4, "uses 4 colour roles", (d) => {
      el(d, "s1", "apple").role = "quantity";
      el(d, "s1", "earth").role = "valid";
      el(d, "s1", "ground").role = "result";
    }),
  );
  it("does not count the highlight as a colour role", () => {
    const d = doc();
    el(d, "s1", "apple").role = "quantity";
    el(d, "s1", "earth").role = "valid";
    const result = validateDocument(d);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
  it("accepts the result role on a line: it is drawn in ink over a highlight", () => {
    const d = doc();
    el(d, "s2", "twice").role = "result";
    const result = validateDocument(d);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
  it(
    "rejects more than eight labels visible together",
    breaking(4, "labels are visible together", (d) => {
      const extras = [
        ["p1", -3.5, 2.8],
        ["p2", 3.5, 2.8],
        ["p3", -3.5, 0.9],
        ["p4", 3.5, 0.9],
        ["p5", -3.5, -1],
        ["p6", 3.5, -1],
      ] as const;
      for (const [id, x, y] of extras) {
        scene(d, "s1").elements.push({
          id,
          slot: "figure_a",
          type: "point",
          at: [x, y],
          label: id,
        });
      }
      showAll(d, "s1", ...extras.map(([id]) => id));
    }),
  );
  it("accepts labels that are never on screen together", (): void => {
    const d = doc();
    const extras = [
      ["p1", -4, 2.5],
      ["p2", 0, 2.5],
      ["p3", 4, 2.5],
      ["p4", -4, -2.5],
      ["p5", 4, -2.5],
    ] as const;
    for (const [id, x, y] of extras) {
      scene(d, "s1").elements.push({ id, slot: "figure_b", type: "point", at: [x, y], label: id });
    }
    beat(d, "s1", "b2").actions.push({ do: "hide", targets: ["apple", "apple_pull"] });
    beat(d, "s1", "b3").actions.push({ do: "show", targets: extras.map(([id]) => id) });
    const result = validateDocument(d);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
  it(
    "rejects a note too long to sit beside a figure",
    breaking(
      4,
      "a note beside a figure holds 100 at most",
      (d) => (el(d, "s5", "meaning").text = "x".repeat(101)),
    ),
  );
  it(
    "rejects an overloaded slot",
    breaking(4, 'slot "notes" holds 4 elements', (d) => {
      scene(d, "s5").elements.push({
        id: "more",
        slot: "notes",
        type: "text",
        text: "Encore une ligne.",
      });
      showAll(d, "s5", "more");
    }),
  );
});

describe("rule 5 — framing", () => {
  it(
    "rejects an element outside the frame",
    breaking(5, "outside the frame", (d) => (el(d, "s1", "moon").at = [9, 0.5])),
  );
  it(
    "rejects an element that leaves the frame only at a parameter bound",
    breaking(5, "r = 800000000 (its maximum)", (d) => {
      d.model.derived.push({ id: "x_moon", expr: "r / 1e8", unit: "", label: "Position" });
      el(d, "s1", "moon").at = [{ expr: "x_moon" }, 0.5];
    }),
  );
  it(
    "rejects a sweep beyond the range of its parameter",
    breaking(
      5,
      "outside its range",
      (d) => (beat(d, "s3", "b3").actions[0].to = { expr: "3 * r" }),
    ),
  );
  it(
    "rejects labels that overlap",
    breaking(5, 'the labels of "p1" and "p2" overlap', (d) => {
      scene(d, "s1").elements.push(
        { id: "p1", slot: "figure_b", type: "point", at: [0, 2.4], label: "centre" },
        { id: "p2", slot: "figure_b", type: "point", at: [0.1, 2.4], label: "milieu" },
      );
      showAll(d, "s1", "p1", "p2");
    }),
  );
  it("accepts two neighbouring objects: the label of the first goes above its pictogram", () => {
    const d = doc();
    el(d, "s1", "earth").at = [2.2, 0.5];
    el(d, "s1", "earth").size = 0.8;
    const result = validateDocument(d);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
  it(
    "rejects a curve mostly outside the frame",
    breaking(5, "less than half of the curve is inside the frame", (d) => {
      scene(d, "s1").elements.push({
        id: "curve",
        slot: "figure_a",
        type: "plot",
        fn: "x^2 + 100",
      });
      showAll(d, "s1", "curve");
    }),
  );
  it("accepts a curve inside the frame, including one that depends on time", () => {
    const d = doc();
    scene(d, "s1").elements.push({ id: "curve", slot: "figure_a", type: "plot", fn: "sin(x - t)" });
    showAll(d, "s1", "curve");
    const result = validateDocument(d);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
  it(
    "rejects a move that leaves the frame",
    breaking(5, 'sends "apple" to (0, 40)', (d) =>
      beat(d, "s1", "b3").actions.push({ do: "move", target: "apple", to: [0, 40] }),
    ),
  );
});

describe("rule 6 — pedagogy", () => {
  it(
    "rejects an explanation with fewer than four scenes",
    breaking(6, "has 3 steps; expected 4 to 7", (d) => {
      d.scenes = d.scenes.slice(0, 3);
      d.plan.steps = d.plan.steps.slice(0, 3);
      d.quiz.questions = d.quiz.questions.slice(0, 2);
    }),
  );
  it(
    "rejects a plan without a required role",
    breaking(6, 'no step has the role "analogy"', (d) => {
      d.plan.steps[1].role = "mechanism";
      scene(d, "s2").role = "mechanism";
    }),
  );
  it(
    "rejects a plan that does not open with the hook",
    breaking(6, 'the first step must be the "hook"', (d) => {
      [d.plan.steps[0], d.plan.steps[1]] = [d.plan.steps[1], d.plan.steps[0]];
      scene(d, "s1").role = "analogy";
      scene(d, "s2").role = "hook";
    }),
  );
  it(
    "rejects a scene whose role differs from its step in the plan",
    breaking(
      6,
      'is "example" but step 2 of the plan is "mechanism"',
      (d) => (scene(d, "s3").role = "example"),
    ),
  );
  it(
    "rejects an explanation that is too short",
    breaking(6, "expected 45 to 120 s", (d) => {
      for (const s of d.scenes) for (const b of s.beats) b.duration_ms = 1000;
    }),
  );
  it(
    "rejects an explanation that is too long",
    breaking(6, "expected 45 to 120 s", (d) => {
      for (const s of d.scenes) for (const b of s.beats) b.duration_ms = 9000;
    }),
  );
  it(
    "rejects scenes that do not cover the plan",
    breaking(6, "there are 5 scenes for 6 steps", (d) => {
      d.scenes.pop();
    }),
  );

  it("accepts missing scenes when the explanation ended partial", () => {
    const d = doc();
    d.scenes.pop();
    const result = validateDocument(d, { allowPartial: true });
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("accepts one to three scenes for a follow-up answer", () => {
    const d = doc();
    d.scenes = [scene(d, "s3")];
    d.scenes[0].index = 0;
    d.plan.steps = [d.plan.steps[2]];
    delete d.quiz;
    const result = validateDocument(d, { shape: "short" });
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
});

describe("rules are applied in order", () => {
  it("reports only the first rule that fails", () => {
    const d = doc();
    el(d, "s1", "apple_pull").from = "nope";
    el(d, "s1", "apple").role = "quantity";
    el(d, "s1", "earth").role = "valid";
    el(d, "s1", "moon").at = [9, 0.5];
    const result = validateDocument(d);
    if (result.ok) throw new Error("expected a failure");
    expect(result.rule).toBe(2);
    expect(new Set(result.issues.map((problem) => problem.rule))).toEqual(new Set([2]));
  });

  it("formats issues as feedback for the author", () => {
    const d = doc();
    el(d, "s1", "apple_pull").from = "nope";
    const result = validateDocument(d);
    if (result.ok) throw new Error("expected a failure");
    expect(formatIssues(result.issues)).toBe(
      'Rule 2 (references) failed:\n- scene "s1" › element "apple_pull" › from: no element "nope" in this scene',
    );
  });
});

describe("validating one scene against an outline", () => {
  const outline = (): Loose => {
    const d = doc();
    const result = validateOutline({ plan: d.plan, params: d.params, model: d.model });
    if (!result.ok) throw new Error(formatIssues(result.issues));
    return result.value;
  };

  it("rejects a scene beyond the plan", () => {
    const s = scene(doc(), "s6");
    s.index = 6;
    expectFailure(validateScene(s, outline()), 6, "there is no scene 6");
  });

  it("accepts the example scene of the contract", () => {
    const o = outline();
    o.model.derived.push(
      {
        id: "r_view",
        expr: "1 + 4 * (r - 1.5e8) / (8e8 - 1.5e8)",
        unit: "",
        label: "Distance à l'écran",
      },
      { id: "F_view", expr: "clamp(F / 1e20, 0.4, 2.5)", unit: "", label: "Force à l'écran" },
    );
    const example = {
      id: "s3",
      index: 2,
      role: "mechanism",
      title: "Deux masses s'attirent",
      layout: "figure-notes",
      world: { x: [-6, 6], y: [-3, 3] },
      elements: [
        {
          id: "earth",
          slot: "figure",
          type: "object",
          kind: "planet",
          at: [-3, 0],
          size: 1.6,
          label: "Terre",
        },
        {
          id: "moon",
          slot: "figure",
          type: "object",
          kind: "moon",
          at: [{ expr: "r_view" }, 0],
          size: 0.7,
          label: "Lune",
        },
        {
          id: "pull",
          slot: "figure",
          type: "vector",
          from: "moon",
          toward: "earth",
          length: { expr: "F_view" },
          label: "F",
          role: "action",
        },
        {
          id: "dist",
          slot: "figure",
          type: "dimension",
          from: "earth",
          to: "moon",
          label: "r",
          role: "quantity",
        },
        { id: "note", slot: "notes", type: "text", text: "La force vaut {{F|sci:2}} N." },
      ],
      beats: [
        {
          id: "b1",
          narration: "La Terre attire la Lune, et la Lune attire la Terre.",
          actions: [
            { do: "show", targets: ["earth", "moon"], how: "fade" },
            { do: "show", targets: ["pull"], how: "draw" },
          ],
        },
        {
          id: "b2",
          narration: "Si on double la distance, la force est divisée par quatre.",
          actions: [
            { do: "show", targets: ["dist"], how: "draw" },
            { do: "show", targets: ["note"], how: "type" },
            { do: "sweep", param: "r", to: { expr: "2 * r" } },
            { do: "highlight", targets: ["note"] },
          ],
        },
      ],
    };
    const result = validateScene(example, o);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
});

describe("validating an outline", () => {
  it("rejects an unusable model before any scene is written", () => {
    const d = doc();
    d.model.derived[0].expr = "G * m1 * m2 / radius^2";
    expectFailure(
      validateOutline({ plan: d.plan, params: d.params, model: d.model }),
      3,
      'unknown name "radius"',
    );
  });

  it("rejects a plan of the wrong size for a follow-up answer", () => {
    const d = doc();
    expectFailure(
      validateOutline({ plan: d.plan, params: d.params, model: d.model }, { shape: "short" }),
      6,
      "has 6 steps; expected 1 to 3",
    );
  });
});
