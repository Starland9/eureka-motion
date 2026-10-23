import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { DocumentSchema } from "scene";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { GET as getDeep } from "@/app/api/explanations/[id]/deep/route";
import { GET as getEvents } from "@/app/api/explanations/[id]/events/route";
import { GET as getExplanation } from "@/app/api/explanations/[id]/route";
import { POST as postExplanation } from "@/app/api/explanations/route";
import { GET as getHealth } from "@/app/api/health/route";
import { createExplanationClient, type ExplanationClient } from "@/components/explanation/stream";
import { isComplete, type ExplanationState } from "@/components/explanation/types";
import { isPreparing, readDeep } from "@/components/player/deep-version";
import { DeepVersion } from "@/components/player/DeepVersion";
import { messages } from "@/i18n/messages";
import {
  getJobs,
  setContainerForTests,
  setJobsForTests,
  sharePath,
  type Container,
} from "@/server/container";
import { closeDb, createExplanationCache, createExplanationStore } from "@/server/db";
import { createConnection, type Database } from "@/server/db/client";
import { createJobs, type Jobs } from "@/server/db/jobs";
import { jobs } from "@/server/db/schema";
import { resetVoiceAvailability } from "@/server/health/voice";
import { resetGenerationAvailability } from "@/server/http/availability";
import { createFixtureProvider, type Scenario } from "@/server/llm";
import { EventLogRegistry } from "@/server/pipeline/events";
import { Pipeline } from "@/server/pipeline/run";
import { createQuizWriter } from "@/server/pipeline/quiz";
import type { Subject } from "@/server/pipeline/prompts/schemas";
import { resetVoice } from "@/server/tts";
import { FakeVoice, spyOn, steppingClock, type LlmSpy } from "../helpers/fakes";
import { describeTarget, openTestDatabase, testDatabaseUrl } from "../helpers/db";
import { scenarioFromReference } from "../helpers/scenario";
import { eventsIn, readSse, toPipelineEvent, type SseEvent } from "../helpers/sse";

const llm = vi.hoisted(() => ({
  health: vi.fn<() => Promise<{ ok: boolean; latencyMs: number }>>(),
}));

vi.mock("@/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/llm")>()),
  getLlm: () => ({ health: llm.health }),
}));

const DATABASE = "eureka_deep_service_test";
const database = await openTestDatabase(DATABASE);
const target = describeTarget(testDatabaseUrl(DATABASE));
if (!database) console.warn(`PostgreSQL is unreachable at ${target}: integration tests skipped`);

const ORIGIN = "http://localhost:3000";
const KOKORO = "http://kokoro.test";
const SECRET = "connection refused to postgres://admin:hunter2@10.0.0.5:5432/eureka";
const T0 = new Date("2026-03-04T10:00:00.000Z");
// Far enough ahead that a stored explanation never expires during a test.
const CLOCK_START = new Date("2099-01-01T09:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const QUESTION = reference.question;
const SCENE_COUNT = DocumentSchema.parse(reference.payload).scenes.length;
const ROUTES = /^\/api\/explanations\/([^/]+)(\/events|\/deep)?$/;

function triage(subject: Subject, deepEligible: boolean) {
  return {
    decision: "accept",
    reason: "",
    concept: { slug: reference.slug, title: reference.title, subject },
    interpretations: [],
    detected_language: "fr",
    deep_eligible: deepEligible,
  };
}

function conceptScenario(subject: Subject, deepEligible: boolean): Scenario {
  return scenarioFromReference(reference, {
    quiz: {},
    replace: { triage: { response: triage(subject, deepEligible) } },
  });
}

const MATHS = conceptScenario("maths", true);
const HISTORY = conceptScenario("other", false);

const LETTERS = "abcdefghjkmnpqrstuvwxyz";

function routableIds(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return (
      "k".repeat(10) +
      LETTERS[Math.floor(counter / LETTERS.length)]! +
      LETTERS[counter % LETTERS.length]!
    );
  };
}

const typesOf = (events: SseEvent[]): string[] => events.map((event) => event.type);

function ago(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function expectNormalRun(events: SseEvent[]): void {
  const types = typesOf(events);
  expect(types[0]).toBe("accepted");
  expect(types.at(-1)).toBe("done");
  expect(events.at(-1)?.data).toMatchObject({ status: "ready" });
  expect(events.filter((event) => event.type === "scene").map((event) => event.data.index)).toEqual(
    Array.from({ length: SCENE_COUNT }, (_, index) => index),
  );
  expect(types).toContain("quiz");
  expect(types).not.toContain("scene_dropped");
  expect(types).not.toContain("error");
}

function expectNoDeepEvent(events: SseEvent[]): void {
  expect(typesOf(events)).not.toContain("deep");
  expectNormalRun(events);
}

function expectNothingAnnounced(state: ExplanationState): void {
  expect(isComplete(state)).toBe(true);
  expect(state).toMatchObject({
    status: "ready",
    deep: null,
    error: null,
    refusal: null,
    clarify: null,
    redirected: false,
    dropped: [],
  });
  expect(state.scenes).toHaveLength(SCENE_COUNT);
  expect(state.quiz).not.toBeNull();
  expect(markupOf(state)).toBe("");
}

function markupOf(state: ExplanationState): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: "fr",
      messages: messages.fr,
      timeZone: "UTC",
      children: createElement(DeepVersion, { explanationId: state.id ?? "", initial: state.deep }),
    }),
  );
}

interface Service {
  container: Container;
  llm: LlmSpy;
  restart(): void;
}

describe.skipIf(!database)(
  database
    ? `deep version failures on ${target}`
    : `deep version failures (skipped: PostgreSQL unreachable at ${target})`,
  () => {
    let db: Database;
    let store: ReturnType<typeof createExplanationStore>;
    let queue: Jobs;
    let service: Service;
    let mediaDir: string;
    let time = T0.getTime();
    const clients: ExplanationClient[] = [];

    const now = () => new Date(time);
    const advance = (ms: number) => {
      time += ms;
    };

    function boot(scenario: Scenario, options: { deep?: boolean } = {}): Service {
      const provider = spyOn(createFixtureProvider([scenario]));
      const newId = routableIds();
      const clock = steppingClock(CLOCK_START);
      const assemble = (): Container => {
        const logs = new EventLogRegistry();
        const pipeline = new Pipeline(
          {
            llm: provider,
            store,
            cache: createExplanationCache(db),
            voice: new FakeVoice(),
            newId,
            now: clock,
            shareUrl: sharePath,
            writeQuiz: createQuizWriter(provider),
            ...(options.deep === false
              ? {}
              : {
                  enqueueDeep: async (id: string) => {
                    await getJobs().enqueue(id, "deep");
                  },
                }),
          },
          logs,
        );
        return {
          pipeline,
          store,
          cache: createExplanationCache(db),
          limiter: { check: async () => ({ allowed: true }) },
          logs,
        };
      };
      const current: Service = {
        container: assemble(),
        llm: provider,
        restart() {
          current.container = assemble();
          setContainerForTests(current.container);
        },
      };
      setContainerForTests(current.container);
      service = current;
      return current;
    }

    async function serviceFetch(
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> {
      const url = new URL(input instanceof Request ? input.url : String(input), ORIGIN);
      if (url.origin === KOKORO) return new Response("ok");
      const request = new Request(url, init);
      if (url.pathname === "/api/health") return getHealth();
      if (url.pathname === "/api/explanations") return postExplanation(request);
      const match = ROUTES.exec(url.pathname);
      if (!match) throw new Error(`No route answers ${url.pathname}`);
      const context = { params: Promise.resolve({ id: match[1]! }) };
      if (match[2] === "/events") return getEvents(request, context);
      if (match[2] === "/deep") return getDeep(request, context);
      return getExplanation(request, context);
    }

    const get = (pathname: string) => serviceFetch(pathname);

    async function ask(question = QUESTION) {
      const response = await serviceFetch("/api/explanations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, language: "fr", level: "lycee" }),
      });
      expect(response.status).toBe(200);
      const events = eventsIn(await readSse(response));
      return { id: String(events[0]?.data.explanation_id), events };
    }

    // A new registry stands for the replay of a stored record: the live log of a finished run is
    // kept for ten minutes, longer than a stopped service is allowed to take.
    async function replay(id: string): Promise<SseEvent[]> {
      service.restart();
      const response = await get(`/api/explanations/${id}/events`);
      expect(response.status).toBe(200);
      return eventsIn(await readSse(response));
    }

    async function deepRoute(id: string) {
      const response = await get(`/api/explanations/${id}/deep`);
      const text = await response.text();
      return { response, text, body: JSON.parse(text) as unknown };
    }

    async function describeExplanation(id: string) {
      const response = await get(`/api/explanations/${id}`);
      const text = await response.text();
      return { response, text, body: JSON.parse(text) as Record<string, unknown> };
    }

    function newClient(): ExplanationClient {
      const client = createExplanationClient({
        fetch: serviceFetch,
        wait: async () => undefined,
        interfaceLanguage: () => "fr",
      });
      clients.push(client);
      return client;
    }

    function settled(client: ExplanationClient): Promise<ExplanationState> {
      return new Promise((resolve) => {
        const unsubscribe = client.subscribe(check);
        function check(): void {
          const state = client.getSnapshot().state;
          if (
            state &&
            isComplete(state) &&
            (state.generator !== null || state.status !== "ready")
          ) {
            unsubscribe();
            resolve(state);
          }
        }
        check();
      });
    }

    async function liveState(question = QUESTION): Promise<ExplanationState> {
      const client = newClient();
      const outcome = await client.start({ question, language: "fr", level: "lycee" });
      expect(outcome.kind).toBe("accepted");
      return settled(client);
    }

    async function replayedState(id: string): Promise<ExplanationState> {
      service.restart();
      const client = newClient();
      client.open(id);
      return settled(client);
    }

    const jobRows = () => db.select().from(jobs).orderBy(asc(jobs.id));

    async function reserved(id: string) {
      const job = await queue.reserve("deep");
      if (job?.explanation_id !== id) throw new Error(`The worker did not reserve ${id}`);
      return job;
    }

    async function abandonLikeTheWorker(id: string, reason = SECRET): Promise<void> {
      const job = await reserved(id);
      expect(await queue.abandon(job.id, reason)).toMatchObject({ status: "abandoned" });
    }

    async function writeBeat(beat: unknown): Promise<void> {
      await mkdir(path.join(mediaDir, ".health"), { recursive: true });
      await writeFile(path.join(mediaDir, ".health", "worker.json"), JSON.stringify(beat));
    }

    async function healthChecks(): Promise<Record<string, boolean>> {
      resetGenerationAvailability();
      resetVoiceAvailability();
      const response = await get("/api/health");
      expect(response.status).toBe(200);
      return ((await response.json()) as { checks: Record<string, boolean> }).checks;
    }

    beforeAll(async () => {
      if (!database) return;
      db = database.db;
      store = createExplanationStore(db);
      mediaDir = await mkdtemp(path.join(tmpdir(), "eureka-deep-service-"));
      vi.stubEnv("MEDIA_DIR", mediaDir);
      vi.stubEnv("DATABASE_URL", testDatabaseUrl(DATABASE).href);
      vi.stubEnv("TTS_PROVIDERS", "kokoro");
      vi.stubEnv("KOKORO_BASE_URL", KOKORO);
      vi.stubGlobal("fetch", serviceFetch);
    });

    beforeEach(async () => {
      time = T0.getTime();
      queue = createJobs(db, { now });
      await database?.reset();
      await rm(mediaDir, { recursive: true, force: true });
      await mkdir(mediaDir, { recursive: true });
      llm.health.mockResolvedValue({ ok: true, latencyMs: 1 });
      resetGenerationAvailability();
      resetVoiceAvailability();
      resetVoice();
      setJobsForTests(queue);
    });

    afterEach(() => {
      for (const client of clients.splice(0)) client.abort();
      vi.restoreAllMocks();
      setContainerForTests(undefined);
      setJobsForTests(undefined);
      resetVoice();
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await closeDb();
      await rm(mediaDir, { recursive: true, force: true });
      await database?.close();
    });

    describe("the manim service is stopped", () => {
      beforeEach(async () => {
        await writeBeat({ render_at: ago(1), deep_at: null });
      });

      it("answers a maths question normally and announces the deep job just before done", async () => {
        boot(MATHS);
        const { id, events } = await ask();

        expectNormalRun(events);
        expect(events.filter((event) => event.type === "deep").map((event) => event.data)).toEqual([
          { status: "queued" },
        ]);
        expect(typesOf(events).slice(-2)).toEqual(["deep", "done"]);

        expect((await store.get(id))?.status).toBe("ready");
        expect((await store.get(id))?.payload.scenes).toHaveLength(SCENE_COUNT);
        expect((await store.get(id))?.payload.quiz).not.toBeNull();
        expect(await jobRows()).toEqual([
          expect.objectContaining({
            explanation_id: id,
            type: "deep",
            status: "queued",
            attempts: 0,
            result_url: null,
          }),
        ]);
      });

      it("streams the same events in the same order as a service without a deep version", async () => {
        boot(MATHS);
        const withDeep = (await ask()).events.map(toPipelineEvent);
        expect(withDeep.at(-2)).toEqual({ type: "deep", status: "queued" });

        await database?.reset();
        boot(MATHS, { deep: false });
        const without = (await ask()).events.map(toPipelineEvent);

        expect(withDeep.filter((event) => event.type !== "deep")).toEqual(without);
      });

      it("leaves the interface with the preparing line only, and no error", async () => {
        boot(MATHS);
        const live = await liveState();
        expect(live).toMatchObject({ status: "ready", deep: { status: "queued" }, error: null });
        expect(live.scenes).toHaveLength(SCENE_COUNT);
        expect(live.quiz).not.toBeNull();
        expect(markupOf(live)).toContain(messages.fr.Deep.preparing);
      });

      it.each([
        [
          "the worker has nothing to report about the sandbox",
          { render_at: ago(1), deep_at: null },
          true,
        ],
        [
          "the heartbeat of the sandbox is five minutes old",
          { render_at: ago(1), deep_at: ago(300) },
          true,
        ],
        ["the worker file does not exist", undefined, false],
      ])(
        "reports deep_worker false on /api/health with a 200 when %s",
        async (_label, beat, renderWorker) => {
          if (beat) await writeBeat(beat);
          else await rm(path.join(mediaDir, ".health"), { recursive: true, force: true });
          boot(MATHS);
          await ask();

          const response = await get("/api/health");
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(await response.json()).toEqual({
            status: "degraded",
            checks: {
              database: true,
              generation: true,
              voice: true,
              render_worker: renderWorker,
              deep_worker: false,
            },
          });
        },
      );

      it("changes nothing but deep_worker when the sandbox beats again", async () => {
        const stopped = await healthChecks();
        expect(stopped).toEqual({
          database: true,
          generation: true,
          voice: true,
          render_worker: true,
          deep_worker: false,
        });

        await writeBeat({ render_at: ago(1), deep_at: ago(1) });
        expect(await healthChecks()).toEqual({ ...stopped, deep_worker: true });
        const response = await get("/api/health");
        expect(await response.json()).toMatchObject({ status: "ok" });
      });
    });

    interface Ending {
      name: string;
      status: "abandoned" | "none";
      end(id: string): Promise<void>;
    }

    const ENDINGS: Ending[] = [
      {
        name: "is abandoned by the worker because the sandbox is silent",
        status: "abandoned",
        end: (id) => abandonLikeTheWorker(id),
      },
      {
        name: "is abandoned after three failed attempts",
        status: "abandoned",
        end: async (id) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await queue.fail((await reserved(id)).id, SECRET);
          }
        },
      },
      {
        name: "failed for a technical reason",
        status: "abandoned",
        end: async (id) => {
          const job = await reserved(id);
          await db
            .update(jobs)
            .set({ status: "failed", error: SECRET, finished_at: now() })
            .where(eq(jobs.id, job.id));
        },
      },
      {
        name: "succeeded but left no video file",
        status: "none",
        end: async (id) => {
          const job = await reserved(id);
          await queue.succeed(job.id, `/media/${id}/deep.mp4`);
        },
      },
    ];

    describe.each(ENDINGS)("when the deep version $name", ({ status, end }) => {
      async function finished() {
        boot(MATHS);
        const { id } = await ask();
        await end(id);
        return id;
      }

      it(`answers ${status} on the deep route, with no video and nothing about the job`, async () => {
        const id = await finished();
        const { response, text, body } = await deepRoute(id);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toEqual({ status, result_url: null });
        expect(text).not.toContain("hunter2");
      });

      it("describes the explanation as ready and playable, with the same deep status", async () => {
        const id = await finished();
        const { response, text, body } = await describeExplanation(id);
        expect(response.status).toBe(200);
        expect(body).toMatchObject({ status: "ready", deep: { status, result_url: null } });
        expect((body.payload as { scenes: unknown[] }).scenes).toHaveLength(SCENE_COUNT);
        expect(text).not.toContain("hunter2");
      });

      it("replays the explanation up to done without any deep event", async () => {
        const id = await finished();
        const events = await replay(id);
        expectNoDeepEvent(events);
        expect(JSON.stringify(events)).not.toContain("hunter2");
      });

      it("answers the same question from the cache without a trace of it, a job or a model call", async () => {
        const id = await finished();
        const calls = service.llm.calls.length;
        const cached = await ask();

        expect(cached.events[0]?.data).toEqual({ explanation_id: id, cached: true });
        expectNoDeepEvent(cached.events);
        expect(JSON.stringify(cached.events)).not.toContain("hunter2");
        expect(service.llm.calls).toHaveLength(calls);
        expect(await jobRows()).toHaveLength(1);
      });

      it("leaves the interface with nothing to announce once the job has ended", async () => {
        boot(MATHS);
        const client = newClient();
        await client.start({ question: QUESTION, language: "fr", level: "lycee" });
        const live = await settled(client);
        expect(live.deep).toEqual({ status: "queued" });
        expect(markupOf(live)).toContain(messages.fr.Deep.preparing);

        const id = String(live.id);
        await end(id);

        const read = await readDeep(id, new AbortController().signal);
        expect(read).toEqual({ kind: "answer", status, resultUrl: null });
        expect(isPreparing(status)).toBe(false);

        const replayed = await replayedState(id);
        expectNothingAnnounced(replayed);
        expect(replayed.id).toBe(id);
      });
    });

    describe("a concept that is not eligible", () => {
      it("creates no job and emits no deep event", async () => {
        boot(HISTORY);
        const { id, events } = await ask();
        expectNoDeepEvent(events);
        expect(events.find((event) => event.type === "meta")?.data).toMatchObject({
          deep_eligible: false,
        });
        expect(await jobRows()).toEqual([]);
        expect((await store.get(id))?.status).toBe("ready");
      });

      it("answers none on the deep route and in the description of the explanation", async () => {
        boot(HISTORY);
        const { id } = await ask();
        expect((await deepRoute(id)).body).toEqual({ status: "none", result_url: null });
        expect((await describeExplanation(id)).body).toMatchObject({
          status: "ready",
          deep: { status: "none", result_url: null },
        });
      });

      it("leaves the interface with nothing to announce, live and replayed", async () => {
        boot(HISTORY);
        const live = await liveState();
        expectNothingAnnounced(live);
        const id = String(live.id);

        expectNoDeepEvent(await replay(id));
        expectNothingAnnounced(await replayedState(id));
        expect(await readDeep(id, new AbortController().signal)).toEqual({
          kind: "answer",
          status: "none",
          resultUrl: null,
        });
      });
    });

    describe("the jobs database fails when the job is created", () => {
      beforeEach(async () => {
        const gone = createConnection(testDatabaseUrl(DATABASE).href, { max: 1 });
        await gone.client.end();
        setJobsForTests(createJobs(gone.db));
      });

      it("ends the explanation ready, without a deep event, and logs the failure", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        boot(MATHS);
        const { id, events } = await ask();

        expectNoDeepEvent(events);
        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining(id), expect.anything());
        for (const leak of ["CONNECTION_ENDED", "127.0.0.1", "eureka:eureka"]) {
          expect(JSON.stringify(events)).not.toContain(leak);
        }
        expect((await store.get(id))?.status).toBe("ready");
        expect(await jobRows()).toEqual([]);
      });

      it("streams the same events as a service without a deep version", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        boot(MATHS);
        const failing = (await ask()).events.map(toPipelineEvent);

        await database?.reset();
        boot(MATHS, { deep: false });
        expect((await ask()).events.map(toPipelineEvent)).toEqual(failing);
      });

      it("answers the same question from the cache and replays the explanation without a deep event", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        boot(MATHS);
        const { id } = await ask();

        const cached = await ask();
        expect(cached.events[0]?.data).toEqual({ explanation_id: id, cached: true });
        expectNoDeepEvent(cached.events);
        expectNoDeepEvent(await replay(id));
      });

      it("describes the explanation without a deep version and the interface shows nothing", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        boot(MATHS);
        const live = await liveState();
        expectNothingAnnounced(live);
        const id = String(live.id);

        expect((await describeExplanation(id)).body).toMatchObject({
          status: "ready",
          deep: { status: "none", result_url: null },
        });
        expect(await readDeep(id, new AbortController().signal)).toEqual({ kind: "failed" });
        expectNothingAnnounced(await replayedState(id));
      });

      it("leaves no trace once the jobs database is back", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        boot(MATHS);
        const { id } = await ask();
        setJobsForTests(queue);

        expect((await deepRoute(id)).body).toEqual({ status: "none", result_url: null });
        expectNoDeepEvent(await replay(id));
        expect(await jobRows()).toEqual([]);
      });
    });

    describe("the worker comes back later", () => {
      it("never puts an abandoned job back in the queue", async () => {
        boot(MATHS);
        const { id } = await ask();
        await abandonLikeTheWorker(id);

        await writeBeat({ render_at: ago(1), deep_at: ago(1) });
        expect((await healthChecks()).deep_worker).toBe(true);

        advance(2 * HOUR);
        expect(await queue.requeueStale()).toEqual([]);
        expect(await queue.reserve("deep")).toBeNull();
        expect(await jobRows()).toEqual([
          expect.objectContaining({ explanation_id: id, status: "abandoned", attempts: 1 }),
        ]);
        expect((await deepRoute(id)).body).toEqual({ status: "abandoned", result_url: null });
        expectNoDeepEvent(await replay(id));
      });

      it("creates no new job when the explanation is replayed, read or answered from the cache", async () => {
        boot(MATHS);
        const { id } = await ask();
        await abandonLikeTheWorker(id);
        await writeBeat({ render_at: ago(1), deep_at: ago(1) });
        const calls = service.llm.calls.length;

        for (let visit = 0; visit < 3; visit += 1) {
          advance(HOUR);
          expectNoDeepEvent(await replay(id));
          expect((await deepRoute(id)).body).toEqual({ status: "abandoned", result_url: null });
          expect((await describeExplanation(id)).body).toMatchObject({
            deep: { status: "abandoned", result_url: null },
          });
          expectNoDeepEvent((await ask()).events);
          expectNothingAnnounced(await replayedState(id));
        }

        expect(await jobRows()).toEqual([
          expect.objectContaining({ explanation_id: id, status: "abandoned" }),
        ]);
        expect(await queue.reserve("deep")).toBeNull();
        expect(service.llm.calls).toHaveLength(calls);
      });

      it("lets the worker finish a job that was only waiting while the service was stopped", async () => {
        await writeBeat({ render_at: ago(1), deep_at: null });
        boot(MATHS);
        const { id } = await ask();
        expect((await replay(id)).filter((event) => event.type === "deep")).toEqual([
          expect.objectContaining({ data: { status: "queued" } }),
        ]);

        await writeBeat({ render_at: ago(1), deep_at: ago(1) });
        const job = await reserved(id);
        await mkdir(path.join(mediaDir, id), { recursive: true });
        await writeFile(path.join(mediaDir, id, "deep.mp4"), "video");
        await queue.succeed(job.id, `/media/${id}/deep.mp4`);

        expect((await deepRoute(id)).body).toEqual({
          status: "ready",
          result_url: `/media/${id}/deep.mp4`,
        });
        const events = await replay(id);
        expect(typesOf(events).slice(-2)).toEqual(["deep", "done"]);
        expect(events.at(-2)?.data).toEqual({ status: "ready" });
        expect(await jobRows()).toHaveLength(1);
      });
    });
  },
);
