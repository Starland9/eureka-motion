import type { Language } from "scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReference } from "../../src/app/api/reference/route";
import { POST } from "../../src/app/api/explanations/route";
import { GET as getEvents } from "../../src/app/api/explanations/[id]/events/route";
import { GET as getExplanation } from "../../src/app/api/explanations/[id]/route";
import { GET as getVersions } from "../../src/app/api/explanations/[id]/versions/route";
import type { RateLimiter, RateLimitResult } from "../../src/server/db/rate-limit";
import { setContainerForTests, sharePath } from "../../src/server/container";
import { resetGenerationAvailability } from "../../src/server/http/availability";
import { errorMessage, type ErrorCode } from "../../src/server/http/errors";
import { createFixtureProvider } from "../../src/server/llm";
import { EventLogRegistry } from "../../src/server/pipeline/events";
import type { ExplanationRecord } from "../../src/server/pipeline/ports";
import { Pipeline } from "../../src/server/pipeline/run";
import { FakeVoice, MemoryCache, MemoryStore } from "../helpers/fakes";

const llm = vi.hoisted(() => ({
  health: vi.fn<() => Promise<{ ok: boolean; latencyMs: number }>>(),
}));

vi.mock("../../src/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/llm")>()),
  getLlm: () => ({ health: llm.health }),
}));

const ORIGIN = "http://localhost:3000";
const LANGUAGES: Language[] = ["fr", "en"];
const UNKNOWN_ID = "u".repeat(12);
const EXPIRED_ID = "e".repeat(12);
const QUESTION = "pourquoi la Lune ne tombe pas sur la Terre";

class ExpiringStore extends MemoryStore {
  override async get(id: string) {
    return (await this.isExpired(id)) ? null : super.get(id);
  }
}

class FakeLimiter implements RateLimiter {
  result: RateLimitResult = { allowed: true };
  failure: Error | null = null;

  async check(): Promise<RateLimitResult> {
    if (this.failure) throw this.failure;
    return this.result;
  }
}

function expiredRecord(): ExplanationRecord {
  return {
    id: EXPIRED_ID,
    kind: "initial",
    parent_id: null,
    root_id: EXPIRED_ID,
    focus_scene_id: null,
    question: QUESTION,
    language: "fr",
    level: "lycee",
    concept_slug: null,
    subject: null,
    title: null,
    status: "ready",
    payload: {
      version: 1,
      plan: null,
      params: [],
      model: { constants: [], derived: [] },
      scenes: [],
      quiz: null,
    },
    verdicts: [],
    scene_count_planned: null,
    provider: "fixture",
    model: "fixture",
    timings: {},
    created_at: new Date("2020-01-01T00:00:00.000Z"),
    completed_at: null,
    expires_at: new Date("2020-01-02T00:00:00.000Z"),
  };
}

let limiter: FakeLimiter;

async function boot(): Promise<void> {
  const store = new ExpiringStore();
  await store.create(expiredRecord());
  const cache = new MemoryCache();
  const logs = new EventLogRegistry();
  limiter = new FakeLimiter();
  const pipeline = new Pipeline(
    {
      llm: createFixtureProvider([]),
      store,
      cache,
      voice: new FakeVoice(),
      newId: () => "n".repeat(12),
      now: () => new Date(),
      shareUrl: sharePath,
    },
    logs,
  );
  setContainerForTests({ pipeline, store, cache, limiter, logs });
}

beforeEach(async () => {
  resetGenerationAvailability();
  llm.health.mockReset();
  llm.health.mockResolvedValue({ ok: true, latencyMs: 0 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await boot();
});

afterEach(() => {
  setContainerForTests(undefined);
  vi.restoreAllMocks();
});

const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  POST(
    new Request(`${ORIGIN}/api/explanations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const acceptLanguage = (language: Language) => ({ "accept-language": language });

const getById = (
  route: typeof getExplanation,
  id: string,
  language: Language,
  query = "",
): Promise<Response> =>
  route(
    new Request(`${ORIGIN}/api/explanations/${id}${query}`, { headers: acceptLanguage(language) }),
    context(id),
  );

const valid = (language: Language) => ({ question: QUESTION, language, level: "lycee" });

interface Trigger {
  status: number;
  call: (language: Language) => Promise<Response>;
}

// "mode_not_supported" is no longer raised by any route: its messages are covered in unit/http-errors.
const TRIGGERS: Record<Exclude<ErrorCode, "mode_not_supported">, Trigger[]> = {
  invalid_request: [
    { status: 400, call: (language) => post({ ...valid(language), level: "primaire" }) },
    {
      status: 400,
      call: (language) => post({ question: QUESTION, level: "lycee" }, acceptLanguage(language)),
    },
    {
      status: 400,
      call: (language) => getById(getEvents, UNKNOWN_ID, language, "/events?after=-1"),
    },
    {
      status: 400,
      call: (language) =>
        getReference(
          new Request(`${ORIGIN}/api/reference?language=de`, { headers: acceptLanguage(language) }),
        ),
    },
  ],
  parent_not_found: [
    {
      status: 404,
      call: (language) =>
        post({ language, level: "lycee", mode: "simpler", parent_id: UNKNOWN_ID }),
    },
  ],
  not_found: [
    { status: 404, call: (language) => getById(getExplanation, UNKNOWN_ID, language) },
    { status: 404, call: (language) => getById(getExplanation, "short", language) },
    { status: 404, call: (language) => getById(getEvents, UNKNOWN_ID, language) },
    { status: 404, call: (language) => getById(getVersions, UNKNOWN_ID, language) },
  ],
  expired: [
    { status: 410, call: (language) => getById(getExplanation, EXPIRED_ID, language) },
    { status: 410, call: (language) => getById(getEvents, EXPIRED_ID, language) },
    { status: 410, call: (language) => getById(getVersions, EXPIRED_ID, language) },
  ],
  rate_limited: [
    {
      status: 429,
      call: (language) => {
        limiter.result = { allowed: false, retryAfterSeconds: 90 };
        return post(valid(language));
      },
    },
  ],
  generation_unavailable: [
    {
      status: 503,
      call: (language) => {
        llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
        return post(valid(language));
      },
    },
  ],
  internal_error: [
    {
      status: 500,
      call: (language) => {
        limiter.failure = new Error("postgres://admin:hunter2@10.0.0.5/eureka");
        return post(valid(language));
      },
    },
  ],
};

const CASES = (Object.keys(TRIGGERS) as (keyof typeof TRIGGERS)[]).flatMap((code) =>
  LANGUAGES.flatMap((language) =>
    TRIGGERS[code].map((trigger, index) => ({ code, language, trigger, index })),
  ),
);

describe("API errors in the language of the request", () => {
  it.each(CASES)("$code #$index is answered in $language", async ({ code, language, trigger }) => {
    const response = await trigger.call(language);
    expect(response.status).toBe(trigger.status);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code, message: errorMessage(language, code) });
    expect(body.error.message).not.toBe(errorMessage(language === "fr" ? "en" : "fr", code));
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("sends Retry-After with the rate limit message", async () => {
    limiter.result = { allowed: false, retryAfterSeconds: 90 };
    const response = await post(valid("en"));
    expect(response.headers.get("retry-after")).toBe("90");
  });

  it.each(LANGUAGES)(
    "prefers the language of the body to Accept-Language (%s)",
    async (language) => {
      const other = language === "fr" ? "en" : "fr";
      const response = await post({ ...valid(language), level: "primaire" }, acceptLanguage(other));
      const { error } = (await response.json()) as { error: { message: string } };
      expect(error.message).toBe(errorMessage(language, "invalid_request"));
    },
  );

  it("answers in French when neither the body nor the header names a supported language", async () => {
    const response = await post(
      { question: QUESTION, level: "lycee" },
      { "accept-language": "de" },
    );
    const { error } = (await response.json()) as { error: { message: string } };
    expect(error.message).toBe(errorMessage("fr", "invalid_request"));
  });
});
