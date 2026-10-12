import type { Scene } from "scene";
import { describe, expect, it } from "vitest";
import {
  checkKey,
  checkSets,
  narrationOf,
  secondsOf,
  verificationRows,
} from "@/components/colophon/rows";
import type { ExplanationState } from "@/components/explanation/types";

type Plan = NonNullable<ExplanationState["plan"]>;

const steps = ["hook", "analogy", "mechanism", "formula"] as const;

const plan = {
  objective: "o",
  prerequisites: [],
  analogy: { name: "n", mapping: "m" },
  key_rule: { statement: "s" },
  steps: steps.map((role) => ({ role, intent: "i", visual: "v" })),
} satisfies Plan;

function scene(index: number): Scene {
  return {
    id: `s${index + 1}`,
    index,
    role: steps[index] ?? "recap",
    title: `Titre ${index + 1}`,
    beats: [
      { id: "b1", narration: "Une phrase." },
      { id: "b2", narration: "Deux phrases." },
    ],
  } as unknown as Scene;
}

function verdict(
  target: string,
  status: "validated" | "corrected" | "dropped",
  attempts = 1,
  reason = "raison",
) {
  return { target, status, attempts, reason, checks: ["structure"] };
}

describe("verificationRows", () => {
  it("gives the plan line then one line per planned scene", () => {
    const rows = verificationRows({
      plan,
      scenes: [scene(0)],
      verdicts: [verdict("plan", "validated"), verdict("s1", "validated")],
      sceneCount: 4,
      dropped: [],
    });
    expect(rows.map((row) => row.target)).toEqual(["plan", "s1", "s2", "s3", "s4"]);
    expect(rows.map((row) => row.status)).toEqual([
      "validated",
      "validated",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("falls back to the planned role for a scene that has not arrived", () => {
    const rows = verificationRows({
      plan,
      scenes: [],
      verdicts: [],
      sceneCount: 3,
      dropped: [],
    });
    expect(rows[3]).toMatchObject({ title: null, role: "mechanism", status: "pending" });
  });

  it("keeps the reason only for corrected and dropped verdicts", () => {
    const rows = verificationRows({
      plan,
      scenes: [scene(0), scene(1)],
      verdicts: [
        verdict("plan", "validated"),
        verdict("s1", "validated"),
        verdict("s2", "corrected", 2, "unité manquante"),
      ],
      sceneCount: 2,
      dropped: [],
    });
    expect(rows.map((row) => row.reason)).toEqual([null, null, "unité manquante"]);
    expect(rows[2]).toMatchObject({ status: "corrected", attempts: 2 });
  });

  it("reads a scene listed as dropped as removed even without a verdict", () => {
    const rows = verificationRows({
      plan,
      scenes: [scene(0)],
      verdicts: [verdict("plan", "validated")],
      sceneCount: 2,
      dropped: [1],
    });
    expect(rows[2]).toMatchObject({ status: "dropped", reason: null });
  });

  it("counts the scenes received when the planned count is unknown", () => {
    const rows = verificationRows({
      plan,
      scenes: [scene(0), scene(1)],
      verdicts: [],
      sceneCount: null,
      dropped: [],
    });
    expect(rows).toHaveLength(3);
  });

  it("does not lose a dropped scene past the received ones when the count is unknown", () => {
    const rows = verificationRows({
      plan,
      scenes: [scene(0)],
      verdicts: [verdict("s3", "dropped", 3)],
      sceneCount: null,
      dropped: [2],
    });
    expect(rows.map((row) => row.status)).toEqual(["pending", "pending", "pending", "dropped"]);
  });
});

describe("checkSets", () => {
  it("separates the plan checks from the scene checks and removes duplicates", () => {
    const sets = checkSets([
      { ...verdict("plan", "validated"), checks: ["structure", "accuracy"] },
      { ...verdict("s1", "validated"), checks: ["structure", "references"] },
      { ...verdict("s2", "validated"), checks: ["references", "framing"] },
    ]);
    expect(sets.plan).toEqual(["structure", "accuracy"]);
    expect(sets.scenes).toEqual(["structure", "references", "framing"]);
  });

  it("maps known checks to message keys and ignores the others", () => {
    expect(checkKey("accuracy:fallback")).toBe("accuracyFallback");
    expect(checkKey("structure")).toBe("structure");
    expect(checkKey("toString")).toBeNull();
    expect(checkKey("unknown")).toBeNull();
  });
});

describe("narrationOf and secondsOf", () => {
  it("joins the narration of every beat", () => {
    expect(narrationOf(scene(0))).toBe("Une phrase. Deux phrases.");
  });

  it("converts milliseconds to seconds and returns null when missing", () => {
    expect(secondsOf({ total: 42350 }, "total")).toBe(42.35);
    expect(secondsOf({}, "total")).toBeNull();
    expect(secondsOf({ total: Number.NaN }, "total")).toBeNull();
  });
});
