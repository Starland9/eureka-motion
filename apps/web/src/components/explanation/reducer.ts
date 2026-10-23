import type { SequencedEvent } from "@/server/pipeline/events";
import type { ExplanationState } from "./types";

export function reduceExplanation(
  state: ExplanationState,
  { seq, event }: SequencedEvent,
): ExplanationState {
  if (seq <= state.lastSeq) return state;
  const next = { ...state, lastSeq: seq };

  switch (event.type) {
    case "accepted":
      return { ...next, id: event.explanation_id, cached: event.cached, status: "preparing" };
    case "step":
      return { ...next, steps: { ...state.steps, [event.name]: event.status } };
    case "meta":
      return {
        ...next,
        meta: {
          title: event.title,
          subject: event.subject,
          conceptSlug: event.concept_slug,
          deepEligible: event.deep_eligible,
          detectedLanguage: event.detected_language,
        },
      };
    case "plan":
      return {
        ...next,
        plan: event.plan,
        params: event.params,
        model: event.model,
        sceneCount: event.scene_count,
      };
    case "verdict": {
      const verdict = {
        target: event.target,
        status: event.status,
        attempts: event.attempts,
        reason: event.reason,
        checks: event.checks,
      };
      const known = state.verdicts.some((item) => item.target === verdict.target);
      return {
        ...next,
        verdicts: known
          ? state.verdicts.map((item) => (item.target === verdict.target ? verdict : item))
          : [...state.verdicts, verdict],
      };
    }
    case "scene":
      return {
        ...next,
        status: "streaming",
        scenes: [
          ...state.scenes.filter((scene) => scene.index !== event.scene.index),
          event.scene,
        ].sort((a, b) => a.index - b.index),
      };
    case "scene_dropped":
      return state.dropped.includes(event.index)
        ? next
        : { ...next, dropped: [...state.dropped, event.index] };
    case "quiz":
      return { ...next, quiz: event.quiz };
    case "clarify":
      return {
        ...next,
        status: "clarify",
        clarify: { reason: event.reason, interpretations: event.interpretations },
      };
    case "refused":
      return { ...next, status: "refused", refusal: event.reason };
    case "cached":
      return { ...next, redirectTo: event.explanation_id };
    case "redirected":
      return { ...next, redirected: true };
    case "done":
      return { ...next, status: event.status, shareUrl: event.share_url };
    case "error":
      return { ...next, status: "failed", error: { code: event.code, message: event.message } };
    default:
      // deep, and any event type this client does not know
      return next;
  }
}
