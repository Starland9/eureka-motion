import type { Language, Level } from "scene";
import { createExplanationClient, type ExplanationClient } from "./stream";
import { isComplete, type ExplanationState, type StartOutcome } from "./types";

export type LevelRejection = Extract<StartOutcome, { kind: "rejected" }>;

export type LevelRequestView =
  | { kind: "idle" }
  | { kind: "preparing"; level: Level; done: number; total: number | null; openId: string | null }
  | { kind: "ready"; level: Level; openId: string }
  | { kind: "rejected"; level: Level; rejection: LevelRejection };

export interface LevelSource {
  question: string;
  language: Language;
  level: Level;
}

export interface LevelRequest {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => LevelRequestView;
  request: (level: Level, source: LevelSource) => Promise<void>;
  abort: () => void;
}

const IDLE: LevelRequestView = { kind: "idle" };

function failureOf(state: ExplanationState): LevelRejection | null {
  switch (state.status) {
    case "failed":
      return {
        kind: "rejected",
        code: state.error?.code ?? "network",
        message: state.error?.message ?? "",
      };
    case "refused":
      return { kind: "rejected", code: "refused", message: state.refusal ?? "" };
    case "clarify":
      return { kind: "rejected", code: "clarify", message: state.clarify?.reason ?? "" };
    default:
      return null;
  }
}

function derive(
  level: Level | null,
  rejection: LevelRejection | null,
  state: ExplanationState | null,
): LevelRequestView {
  if (level === null) return IDLE;
  if (rejection !== null) return { kind: "rejected", level, rejection };
  if (state === null) return { kind: "preparing", level, done: 0, total: null, openId: null };

  const done = state.scenes.length;
  const failure = done === 0 ? failureOf(state) : null;
  if (failure !== null) return { kind: "rejected", level, rejection: failure };

  const finished = isComplete(state) || state.redirectTo !== null;
  const target = state.redirectTo ?? state.id;
  if (finished && target !== null) return { kind: "ready", level, openId: target };
  return {
    kind: "preparing",
    level,
    done,
    total: state.sceneCount,
    openId: done > 0 ? target : null,
  };
}

export function createLevelRequest(
  client: ExplanationClient = createExplanationClient(),
): LevelRequest {
  const listeners = new Set<() => void>();
  let level: Level | null = null;
  let rejection: LevelRejection | null = null;
  let view = IDLE;

  const refresh = (): void => {
    view = derive(level, rejection, client.getSnapshot().state);
    for (const listener of [...listeners]) listener();
  };
  client.subscribe(refresh);

  const request = async (next: Level, source: LevelSource): Promise<void> => {
    if (next === source.level) return;
    if (next === level && view.kind !== "rejected") return;
    level = next;
    rejection = null;
    const outcome = await client.start({
      question: source.question,
      language: source.language,
      level: next,
    });
    if (outcome.kind === "accepted" || outcome.code === "superseded") return;
    rejection = outcome;
    refresh();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    request,
    abort: client.abort,
  };
}
