import type { Language, Outline, Quiz, Scene } from "scene";
import type { Subject } from "./prompts/schemas";

export type StepName = "triage" | "plan" | "verify_plan" | "scenes" | "quiz";
export type VerdictStatus = "validated" | "corrected" | "dropped";
export type FinalStatus = "ready" | "partial";

export interface Verdict {
  target: string;
  status: VerdictStatus;
  attempts: number;
  reason: string;
  checks: string[];
}

export type PipelineEvent =
  | { type: "accepted"; explanation_id: string; cached: boolean }
  | { type: "step"; name: StepName; status: "started" | "done" }
  | { type: "clarify"; reason: string; interpretations: { label: string; question: string }[] }
  | { type: "refused"; reason: string }
  | { type: "redirected"; reason: "unrelated_followup" }
  | { type: "cached"; explanation_id: string }
  | {
      type: "meta";
      title: string;
      subject: Subject;
      concept_slug: string;
      deep_eligible: boolean;
      detected_language: Language | "other";
    }
  | {
      type: "plan";
      plan: Outline["plan"];
      params: Outline["params"];
      model: Outline["model"];
      scene_count: number;
    }
  | ({ type: "verdict" } & Verdict)
  | { type: "scene"; index: number; scene: Scene }
  | { type: "scene_dropped"; index: number }
  | { type: "quiz"; quiz: Quiz }
  | { type: "deep"; status: "queued" }
  | { type: "done"; status: FinalStatus; share_url: string }
  | { type: "error"; code: string; message: string };

export interface SequencedEvent {
  seq: number;
  event: PipelineEvent;
}

const TERMINAL = new Set<PipelineEvent["type"]>(["clarify", "refused", "cached", "done", "error"]);

export function isTerminal(event: PipelineEvent): boolean {
  return TERMINAL.has(event.type);
}

type Listener = (item: SequencedEvent) => void;

export class EventLog {
  private readonly items: SequencedEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private finished = false;

  emit(event: PipelineEvent): void {
    if (this.finished) return;
    const item: SequencedEvent = { seq: this.items.length + 1, event };
    this.items.push(item);
    if (isTerminal(event)) this.finished = true;
    for (const listener of [...this.listeners]) listener(item);
  }

  get closed(): boolean {
    return this.finished;
  }

  since(after = 0): SequencedEvent[] {
    return this.items.filter((item) => item.seq > after);
  }

  subscribe(after: number, listener: Listener): () => void {
    for (const item of this.since(after)) listener(item);
    if (this.finished) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async *stream(after = 0, signal?: AbortSignal): AsyncGenerator<SequencedEvent> {
    const queue: SequencedEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = this.subscribe(after, (item) => {
      queue.push(item);
      wake?.();
    });
    const onAbort = (): void => wake?.();
    signal?.addEventListener("abort", onAbort);
    try {
      for (;;) {
        while (queue.length > 0) {
          const item = queue.shift() as SequencedEvent;
          yield item;
          if (isTerminal(item.event)) return;
        }
        if (signal?.aborted || this.finished) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

const RETENTION_MS = 10 * 60 * 1000;

export class EventLogRegistry {
  private readonly logs = new Map<string, { log: EventLog; expires: number | null }>();

  create(id: string): EventLog {
    this.sweep();
    const log = new EventLog();
    this.logs.set(id, { log, expires: null });
    log.subscribe(0, (item) => {
      if (isTerminal(item.event)) {
        const entry = this.logs.get(id);
        if (entry) entry.expires = Date.now() + RETENTION_MS;
      }
    });
    return log;
  }

  get(id: string): EventLog | undefined {
    return this.logs.get(id)?.log;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.logs) {
      if (entry.expires !== null && entry.expires < now) this.logs.delete(id);
    }
  }
}
