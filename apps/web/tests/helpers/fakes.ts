import type { Scene } from "scene";
import type {
  GenerateRequest,
  GenerateResult,
  LlmMessage,
  LlmProvider,
  LlmRole,
} from "../../src/server/llm";
import type { EventLog, PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";
import type {
  CacheKey,
  ExplanationCache,
  ExplanationRecord,
  ExplanationStore,
  LlmTrace,
  VoiceService,
} from "../../src/server/pipeline/ports";

export interface StoreOperation {
  op: "create" | "update" | "remove";
  id: string;
}

export class MemoryStore implements ExplanationStore {
  readonly records = new Map<string, ExplanationRecord>();
  readonly operations: StoreOperation[] = [];

  async create(record: ExplanationRecord): Promise<void> {
    this.operations.push({ op: "create", id: record.id });
    this.records.set(record.id, structuredClone(record));
  }

  async update(id: string, patch: Partial<Omit<ExplanationRecord, "id">>): Promise<void> {
    const current = this.records.get(id);
    if (!current) throw new Error(`No record ${id} to update`);
    this.operations.push({ op: "update", id });
    this.records.set(id, { ...current, ...structuredClone(patch) });
  }

  async get(id: string): Promise<ExplanationRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async remove(id: string): Promise<void> {
    this.operations.push({ op: "remove", id });
    this.records.delete(id);
  }

  operationsOn(id: string): StoreOperation["op"][] {
    return this.operations.filter((entry) => entry.id === id).map((entry) => entry.op);
  }
}

export type CacheCall =
  | { method: "findByQuestion"; question: string; key: CacheKey }
  | { method: "findByConcept"; slug: string; key: CacheKey }
  | { method: "remember"; id: string; entry: CacheKey & { question: string; slug: string } };

type CacheEntry = CacheKey & { id: string; question: string; slug: string };

export class MemoryCache implements ExplanationCache {
  readonly calls: CacheCall[] = [];
  private readonly entries: CacheEntry[] = [];

  seed(id: string, entry: CacheKey & { question: string; slug: string }): void {
    this.entries.push({ id, ...entry });
  }

  async findByQuestion(question: string, key: CacheKey): Promise<string | null> {
    this.calls.push({ method: "findByQuestion", question, key });
    return this.find((entry) => entry.question === question, key);
  }

  async findByConcept(slug: string, key: CacheKey): Promise<string | null> {
    this.calls.push({ method: "findByConcept", slug, key });
    return this.find((entry) => entry.slug === slug, key);
  }

  async remember(id: string, entry: CacheKey & { question: string; slug: string }): Promise<void> {
    this.calls.push({ method: "remember", id, entry });
    this.seed(id, entry);
  }

  private find(match: (entry: CacheEntry) => boolean, key: CacheKey): string | null {
    const found = this.entries.find(
      (entry) => match(entry) && entry.language === key.language && entry.level === key.level,
    );
    return found?.id ?? null;
  }
}

export interface Narration {
  explanationId: string;
  sceneId: string;
}

export class FakeVoice implements VoiceService {
  readonly narrated: Narration[] = [];
  readonly failing = new Set<string>();

  private gate: Promise<void> | null = null;

  constructor(private readonly durationMs = 2_000) {}

  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async narrate(explanationId: string, scene: Scene): Promise<Scene> {
    await this.gate;
    this.narrated.push({ explanationId, sceneId: scene.id });
    if (this.failing.has(scene.id)) throw new Error(`The voice failed on ${scene.id}`);
    return {
      ...scene,
      beats: scene.beats.map((beat) => ({
        ...beat,
        audio: {
          url: `/media/${explanationId}/${scene.id}-${beat.id}.mp3`,
          duration_ms: this.durationMs,
        },
      })),
    };
  }
}

export function sequentialIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `t${String(next).padStart(11, "0")}`;
  };
}

export function steppingClock(
  start = new Date("2026-03-01T09:00:00.000Z"),
  stepMs = 1_000,
): () => Date {
  let current = start.getTime() - stepMs;
  return () => {
    current += stepMs;
    return new Date(current);
  };
}

export async function collectEvents(
  log: EventLog,
  after = 0,
  limitMs = 3_000,
): Promise<SequencedEvent[]> {
  const items: SequencedEvent[] = [];
  for await (const item of log.stream(after, AbortSignal.timeout(limitMs))) items.push(item);
  return items;
}

export function waitForEvent(log: EventLog, type: PipelineEvent["type"]): Promise<SequencedEvent> {
  return new Promise((resolve) => {
    log.subscribe(0, (item) => {
      if (item.event.type === type) resolve(item);
    });
  });
}

export interface RecordedCall {
  role: LlmRole;
  traceId: string | undefined;
  system: string;
  messages: LlmMessage[];
  user: string;
  started: number;
  finished: number | null;
}

export interface LlmSpy extends LlmProvider {
  readonly calls: RecordedCall[];
  peakConcurrency(select: (call: RecordedCall) => boolean): number;
}

export function spyOn(inner: LlmProvider): LlmSpy {
  const calls: RecordedCall[] = [];
  let tick = 0;
  return {
    name: inner.name,
    calls,
    modelFor: (role) => inner.modelFor(role),
    health: () => inner.health(),
    async generateObject<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const call: RecordedCall = {
        role: request.role,
        traceId: request.traceId,
        system: request.system,
        messages: [...request.messages],
        user: request.messages.map((message) => message.content).join("\n"),
        started: ++tick,
        finished: null,
      };
      calls.push(call);
      try {
        return await inner.generateObject(request);
      } finally {
        call.finished = ++tick;
      }
    },
    peakConcurrency(select) {
      const chosen = calls.filter(select);
      return Math.max(
        0,
        ...chosen.map(
          (call) =>
            chosen.filter(
              (other) =>
                other.started <= call.started && (other.finished ?? Infinity) > call.started,
            ).length,
        ),
      );
    },
  };
}

export function traceCollector(): { entries: LlmTrace[]; trace: (entry: LlmTrace) => void } {
  const entries: LlmTrace[] = [];
  return { entries, trace: (entry) => entries.push(entry) };
}
