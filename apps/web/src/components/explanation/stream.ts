import { LANGUAGES, LEVELS, type Language, type Level } from "scene";
import type { ReferenceEntry } from "@/components/ask/Sommaire";
import type { PipelineEvent, SequencedEvent } from "@/server/pipeline/events";
import { reduceExplanation } from "./reducer";
import {
  initialExplanationState,
  isComplete,
  type ExplanationState,
  type StartOutcome,
  type StartRequest,
} from "./types";

const LINE_BREAK = /\r\n|\r|\n/;
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const NEUTRAL_LEVEL: Level = "lycee";

interface Block {
  id: string;
  name: string;
  data: string[];
}

function toItem({ id, name, data }: Block): SequencedEvent | null {
  if (name === "" || data.length === 0 || !/^\d+$/.test(id)) return null;
  const payload = JSON.parse(data.join("\n")) as object;
  return { seq: Number(id), event: { ...payload, type: name } as PipelineEvent };
}

export async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SequencedEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let block: Block = { id: "", name: "", data: [] };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = pending + (done ? decoder.decode() : decoder.decode(value, { stream: true }));
      // A trailing CR may be the first half of a CRLF cut between two chunks.
      const hold = !done && text.endsWith("\r");
      const lines = (hold ? text.slice(0, -1) : text).split(LINE_BREAK);
      pending = (lines.pop() ?? "") + (hold ? "\r" : "");

      for (const line of lines) {
        if (line === "") {
          const item = toItem(block);
          block = { id: "", name: "", data: [] };
          if (item) yield item;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const content = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "id") block.id = content;
          else if (field === "event") block.name = content;
          else if (field === "data") block.data.push(content);
        }
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export interface ExplanationSnapshot {
  state: ExplanationState | null;
  startedHere: boolean;
}

export interface ExplanationClientOptions {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  interfaceLanguage?: () => Language;
}

export interface ExplanationClient {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ExplanationSnapshot;
  start: (request: StartRequest) => Promise<StartOutcome>;
  open: (id: string) => void;
  reset: () => void;
  abort: () => void;
}

interface StoredExplanation {
  language: Language;
  level: Level;
  generator: ExplanationState["generator"];
  timings: Record<string, number>;
}

type RecordResult =
  | { kind: "found"; stored: StoredExplanation }
  | { kind: "missing" | "expired" }
  | { kind: "failed"; code: string; message: string };

const EMPTY: ExplanationSnapshot = { state: null, startedHere: false };

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function documentLanguage(): Language {
  return typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "fr";
}

function finished(state: ExplanationState): boolean {
  return isComplete(state) || state.redirectTo !== null;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

// Sommaire ignores a subject it does not know, so only the shape is checked here.
function isReferenceEntry(value: unknown): value is ReferenceEntry {
  return (
    ["slug", "subject", "title", "explanation_id"].every(
      (key) => typeof field(value, key) === "string",
    ) && LEVELS.some((level) => level === field(value, "reference_level"))
  );
}

async function readFailure(
  response: Response,
): Promise<{ code: string; message: string; references?: ReferenceEntry[] }> {
  try {
    const body: unknown = await response.json();
    const error = field(body, "error");
    const code = field(error, "code");
    const message = field(error, "message");
    const references = field(body, "references");
    if (typeof code === "string") {
      return {
        code,
        message: typeof message === "string" ? message : "",
        ...(Array.isArray(references) ? { references: references.filter(isReferenceEntry) } : {}),
      };
    }
  } catch {
    // The body is not the documented error shape.
  }
  return { code: "http_error", message: "" };
}

function parseStored(record: unknown, fallback: Language): StoredExplanation {
  const language = field(record, "language");
  const level = field(record, "level");
  const provider = field(record, "provider");
  const model = field(record, "model");
  const timings = field(record, "timings");
  return {
    language: LANGUAGES.find((candidate) => candidate === language) ?? fallback,
    level: LEVELS.find((candidate) => candidate === level) ?? NEUTRAL_LEVEL,
    generator:
      typeof provider === "string" && typeof model === "string" ? { provider, model } : null,
    timings:
      typeof timings === "object" && timings !== null
        ? Object.fromEntries(
            Object.entries(timings).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number",
            ),
          )
        : {},
  };
}

export function createExplanationClient(options: ExplanationClientOptions = {}): ExplanationClient {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interfaceLanguage = options.interfaceLanguage ?? documentLanguage;

  let snapshot = EMPTY;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: ExplanationSnapshot): void => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const begin = (): AbortSignal => {
    controller?.abort();
    controller = new AbortController();
    return controller.signal;
  };

  const edit = (
    signal: AbortSignal,
    change: (state: ExplanationState) => ExplanationState,
  ): void => {
    const state = snapshot.state;
    if (signal.aborted || !state) return;
    const next = change(state);
    if (next !== state) publish({ ...snapshot, state: next });
  };

  const replace = (signal: AbortSignal, state: ExplanationState | null): void => {
    if (!signal.aborted) publish({ ...snapshot, state });
  };

  const reject = (
    signal: AbortSignal,
    code: string,
    message: string,
    details: { retryAfterSeconds?: number; references?: ReferenceEntry[] } = {},
  ): StartOutcome => {
    if (signal.aborted) return { kind: "rejected", code: "superseded", message: "" };
    publish(EMPTY);
    return { kind: "rejected", code, message, ...details };
  };

  const fetchRecord = async (
    signal: AbortSignal,
    id: string,
    language: Language,
  ): Promise<RecordResult> => {
    let response: Response;
    try {
      response = await doFetch(`/api/explanations/${encodeURIComponent(id)}`, {
        headers: { "Accept-Language": language },
        signal,
      });
    } catch {
      return { kind: "failed", code: "network", message: "" };
    }
    if (response.status === 404) return { kind: "missing" };
    if (response.status === 410) return { kind: "expired" };
    if (!response.ok) {
      const { code, message } = await readFailure(response);
      return { kind: "failed", code, message };
    }
    try {
      return { kind: "found", stored: parseStored(await response.json(), language) };
    } catch {
      return { kind: "failed", code: "network", message: "" };
    }
  };

  const connect = async (signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> => {
    const state = snapshot.state;
    if (signal.aborted || !state || state.id === null) return null;
    try {
      const response = await doFetch(
        `/api/explanations/${encodeURIComponent(state.id)}/events?after=${state.lastSeq}`,
        { headers: { "Accept-Language": state.language, Accept: "text/event-stream" }, signal },
      );
      return response.ok ? response.body : null;
    } catch {
      return null;
    }
  };

  // Returns how many events moved the state forward.
  const drain = async (
    signal: AbortSignal,
    body: ReadableStream<Uint8Array>,
    progress?: (state: ExplanationState) => void,
  ): Promise<number> => {
    let advanced = 0;
    try {
      for await (const item of parseEventStream(body)) {
        if (signal.aborted) break;
        const before = snapshot.state?.lastSeq ?? 0;
        edit(signal, (state) => reduceExplanation(state, item));
        const state = snapshot.state;
        if (!state) break;
        if (state.lastSeq > before) {
          advanced += 1;
          progress?.(state);
        }
        if (finished(state)) break;
      }
    } catch {
      // A broken stream is resumed by the caller.
    }
    return advanced;
  };

  const enrich = async (signal: AbortSignal, id: string, language: Language): Promise<void> => {
    const result = await fetchRecord(signal, id, language);
    if (result.kind !== "found") return;
    const { generator, timings } = result.stored;
    edit(signal, (state) => ({ ...state, generator, timings }));
  };

  const follow = async (
    signal: AbortSignal,
    first: ReadableStream<Uint8Array> | null,
    progress?: (state: ExplanationState) => void,
  ): Promise<void> => {
    let body = first ?? (await connect(signal));
    let resumed = false;
    let failed = 0;
    for (;;) {
      const advanced = body ? await drain(signal, body, progress) : 0;
      const state = snapshot.state;
      if (signal.aborted || !state || state.id === null) return;
      if (finished(state)) {
        if (state.status === "ready" || state.status === "partial") {
          await enrich(signal, state.id, state.language);
        }
        return;
      }

      failed = advanced > 0 || !resumed ? 0 : failed + 1;
      const delay = RETRY_DELAYS_MS[failed];
      if (delay === undefined) {
        edit(signal, (current) => ({
          ...current,
          status: "failed",
          error: { code: "connection_lost", message: "" },
        }));
        return;
      }
      await wait(delay);
      if (signal.aborted) return;
      body = await connect(signal);
      resumed = true;
    }
  };

  const start = async (request: StartRequest): Promise<StartOutcome> => {
    const signal = begin();
    publish({ state: initialExplanationState(request), startedHere: true });

    let response: Response;
    try {
      response = await doFetch("/api/explanations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": request.language },
        body: JSON.stringify({
          question: request.question,
          language: request.language,
          level: request.level,
          interpretation: request.interpretation,
        }),
        signal,
      });
    } catch {
      return reject(signal, "network", "");
    }
    if (!response.ok) {
      const { code, message, references } = await readFailure(response);
      const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
      return reject(signal, code, message, {
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        ...(references === undefined ? {} : { references }),
      });
    }
    const stream = response.body;
    if (!stream) return reject(signal, "network", "");

    return new Promise<StartOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: StartOutcome): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      void follow(signal, stream, (state) => {
        if (state.id !== null) settle({ kind: "accepted", id: state.id });
      }).then(() => {
        if (!settled) settle(reject(signal, "network", ""));
      });
    });
  };

  const load = async (signal: AbortSignal, id: string): Promise<void> => {
    const language = interfaceLanguage();
    const result = await fetchRecord(signal, id, language);
    if (result.kind === "found") {
      const { stored } = result;
      replace(signal, {
        ...initialExplanationState({
          question: "",
          language: stored.language,
          level: stored.level,
        }),
        id,
        status: "preparing",
        generator: stored.generator,
        timings: stored.timings,
      });
      await follow(signal, null);
      return;
    }
    const base = {
      ...initialExplanationState({ question: "", language, level: NEUTRAL_LEVEL }),
      id,
    };
    replace(
      signal,
      result.kind === "failed"
        ? { ...base, status: "failed", error: { code: result.code, message: result.message } }
        : { ...base, status: result.kind },
    );
  };

  const open = (id: string): void => {
    const { state, startedHere } = snapshot;
    if (state?.id === id) return;
    const signal = begin();
    publish({ state: null, startedHere: startedHere && state?.redirectTo === id });
    void load(signal, id);
  };

  const abort = (): void => {
    controller?.abort();
    controller = null;
  };

  const reset = (): void => {
    abort();
    publish(EMPTY);
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    start,
    open,
    reset,
    abort,
  };
}
