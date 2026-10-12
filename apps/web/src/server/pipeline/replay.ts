import type { PipelineEvent } from "./events";
import type { ExplanationRecord } from "./ports";

const PLAYABLE = new Set<ExplanationRecord["status"]>(["ready", "partial"]);

export function isPlayable(record: ExplanationRecord): boolean {
  return (
    PLAYABLE.has(record.status) && record.payload.plan !== null && record.payload.scenes.length > 0
  );
}

export function replayEvents(record: ExplanationRecord, shareUrl: string): PipelineEvent[] {
  const events: PipelineEvent[] = [{ type: "accepted", explanation_id: record.id, cached: true }];
  const { payload } = record;
  if (!isPlayable(record) || payload.plan === null) {
    events.push({ type: "error", code: "not_available", message: "" });
    return events;
  }

  events.push({
    type: "meta",
    title: record.title ?? "",
    subject: record.subject ?? "other",
    concept_slug: record.concept_slug ?? "",
    deep_eligible: false,
    detected_language: record.language,
  });

  const verdictOf = (target: string) =>
    record.verdicts.find((verdict) => verdict.target === target);
  const planVerdict = verdictOf("plan");
  if (planVerdict) events.push({ type: "verdict", ...planVerdict });

  const count = record.scene_count_planned ?? payload.scenes.length;
  events.push({
    type: "plan",
    plan: payload.plan,
    params: payload.params,
    model: payload.model,
    scene_count: count,
  });

  for (let index = 0; index < count; index += 1) {
    const verdict = verdictOf(`s${index + 1}`);
    if (verdict) events.push({ type: "verdict", ...verdict });
    const scene = payload.scenes.find((candidate) => candidate.index === index);
    events.push(scene ? { type: "scene", index, scene } : { type: "scene_dropped", index });
  }

  if (payload.quiz) events.push({ type: "quiz", quiz: payload.quiz });
  events.push({
    type: "done",
    status: record.status === "ready" ? "ready" : "partial",
    share_url: shareUrl,
  });
  return events;
}
