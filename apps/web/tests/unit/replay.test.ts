import { describe, expect, it } from "vitest";
import { DocumentSchema } from "scene";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import { isPlayable, replayEvents } from "@/server/pipeline/replay";

const document = DocumentSchema.parse(reference.payload);

function record(patch: Partial<ExplanationRecord> = {}): ExplanationRecord {
  return {
    id: "abc123def456",
    kind: "initial",
    parent_id: null,
    root_id: "abc123def456",
    focus_scene_id: null,
    question: "la loi de la gravité",
    language: "fr",
    level: "lycee",
    concept_slug: "physics/universal-gravitation",
    subject: "physics",
    title: "La gravitation universelle",
    status: "ready",
    payload: {
      version: 1,
      plan: document.plan,
      params: document.params,
      model: document.model,
      scenes: document.scenes,
      quiz: document.quiz ?? null,
    },
    verdicts: [
      { target: "plan", status: "validated", attempts: 1, reason: "ok", checks: [] },
      ...document.scenes.map((scene) => ({
        target: scene.id,
        status: "validated" as const,
        attempts: 1,
        reason: "ok",
        checks: [],
      })),
    ],
    scene_count_planned: 6,
    provider: "fixture",
    model: "fixture",
    timings: {},
    created_at: new Date(0),
    completed_at: new Date(0),
    expires_at: null,
    ...patch,
  };
}

describe("replaying a stored explanation", () => {
  it("emits the same sequence a live run would, marked as cached", () => {
    const types = replayEvents(record(), "/fr/e/abc123def456").map((event) => event.type);
    expect(types).toEqual([
      "accepted",
      "meta",
      "verdict",
      "plan",
      ...Array.from({ length: 6 }, () => ["verdict", "scene"]).flat(),
      "quiz",
      "done",
    ]);
  });

  it("marks the run as cached and carries the share link", () => {
    const events = replayEvents(record(), "/fr/e/abc123def456");
    expect(events[0]).toEqual({ type: "accepted", explanation_id: "abc123def456", cached: true });
    expect(events.at(-1)).toEqual({
      type: "done",
      status: "ready",
      share_url: "/fr/e/abc123def456",
    });
  });

  it("replays the status of the deep version after the quiz and before done", () => {
    for (const status of ["queued", "running", "ready"] as const) {
      const types = replayEvents(record(), "/x", status).map((event) => event.type);
      expect(types.slice(-3)).toEqual(["quiz", "deep", "done"]);
      expect(replayEvents(record(), "/x", status).find((event) => event.type === "deep")).toEqual({
        type: "deep",
        status,
      });
    }
  });

  it("replays no deep event when there is no deep version to announce", () => {
    expect(replayEvents(record(), "/x", null).some((event) => event.type === "deep")).toBe(false);
    expect(replayEvents(record(), "/x").some((event) => event.type === "deep")).toBe(false);
  });

  it("keeps scenes in index order and reports the dropped ones", () => {
    const base = record();
    const partial = record({
      status: "partial",
      payload: {
        ...base.payload,
        scenes: base.payload.scenes.filter((scene) => scene.index !== 2),
        quiz: null,
      },
      verdicts: base.verdicts.map((verdict) =>
        verdict.target === "s3" ? { ...verdict, status: "dropped" as const } : verdict,
      ),
    });
    const events = replayEvents(partial, "/x");
    const scenes = events.filter(
      (event) => event.type === "scene" || event.type === "scene_dropped",
    );
    expect(scenes.map((event) => `${event.type}:${event.index}`)).toEqual([
      "scene:0",
      "scene:1",
      "scene_dropped:2",
      "scene:3",
      "scene:4",
      "scene:5",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "partial" });
    expect(events.some((event) => event.type === "quiz")).toBe(false);
  });

  it("does not replay an explanation that never produced a scene", () => {
    for (const status of [
      "triaging",
      "planning",
      "failed",
      "refused",
      "needs_clarification",
    ] as const) {
      const unfinished = record({ status });
      expect(isPlayable(unfinished)).toBe(false);
      expect(replayEvents(unfinished, "/x").map((event) => event.type)).toEqual([
        "accepted",
        "error",
      ]);
    }
  });
});
