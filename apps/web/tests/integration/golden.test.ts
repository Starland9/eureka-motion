import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LANGUAGES, LEVELS } from "scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  median,
  parseSet,
  percentile,
  summarize,
  thresholdFailures,
  type Kind,
  type QuestionResult,
  type Summary,
} from "../../../../scripts/golden";

const run = promisify(execFile);
const WEB = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPTS = fileURLToPath(new URL("../../../../scripts/", import.meta.url));
const GOLDEN = path.join(SCRIPTS, "golden.ts");
const SET_FILE = path.join(SCRIPTS, "golden-set.json");
const REFERENCE_SET_FILE = path.join(SCRIPTS, "reference-set.json");
const SUBJECTS = ["maths", "physics", "chemistry", "biology", "cs", "economics"];

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

interface Report {
  results: QuestionResult[];
  summary: Summary;
  threshold_failures: string[];
}

interface Seen {
  question: string;
  language: string;
  level: string;
  address: string;
  acceptLanguage: string;
}

interface Fake {
  url: string;
  seen: Seen[];
  deepPolls: Map<string, number>;
  close: () => Promise<void>;
}

const STEP_MS = 40;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(request: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: object, headers = {}): void {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

interface Stage {
  cached?: boolean;
  dropped?: number[];
  corrected?: number[];
  deep?: boolean;
}

async function explain(response: ServerResponse, id: string, stage: Stage): Promise<void> {
  const { cached = false, dropped = [], corrected = [], deep = false } = stage;
  let sequence = 0;
  const emit = (name: string, data: object = {}): void => {
    sequence += 1;
    response.write(`id: ${sequence}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const verdict = (target: string, status: string): void =>
    emit("verdict", { target, status, attempts: 1, reason: "test", checks: [] });

  response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
  emit("accepted", { explanation_id: id, cached });
  response.write(": keep-alive\n\n");
  emit("step", { name: "triage", status: "started" });
  await wait(STEP_MS);
  emit("meta", {
    title: "Test",
    subject: "maths",
    concept_slug: "maths/test",
    deep_eligible: deep,
  });
  await wait(STEP_MS);
  emit("plan", { plan: {}, params: [], model: {}, scene_count: 3 });
  verdict("plan", "validated");
  for (let index = 0; index < 3; index += 1) {
    await wait(STEP_MS);
    if (dropped.includes(index)) {
      verdict(`s${index + 1}`, "dropped");
      emit("scene_dropped", { index });
    } else {
      verdict(`s${index + 1}`, corrected.includes(index) ? "corrected" : "validated");
      emit("scene", { index, scene: {} });
    }
  }
  emit("quiz", { quiz: {} });
  if (deep) emit("deep", { status: "queued" });
  emit("done", { status: dropped.length > 0 ? "partial" : "ready", share_url: `/fr/e/${id}` });
  response.end();
}

// A question written "[behaviour:argument] text" selects what the simulated server does.
async function startFake(): Promise<Fake> {
  const seen: Seen[] = [];
  const deepPolls = new Map<string, number>();
  const deepKinds = new Map<string, string>();
  const limited = new Set<string>();
  let counter = 0;

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://fake");
    const deepMatch = /^\/api\/explanations\/([^/]+)\/deep$/.exec(url.pathname);
    if (request.method === "GET" && deepMatch) {
      const id = decodeURIComponent(deepMatch[1]!);
      const polls = (deepPolls.get(id) ?? 0) + 1;
      deepPolls.set(id, polls);
      const kind = deepKinds.get(id);
      const status =
        kind === "deep-stuck"
          ? "running"
          : kind === "deep-abandoned"
            ? polls < 2
              ? "queued"
              : "abandoned"
            : polls < 2
              ? "queued"
              : polls < 3
                ? "running"
                : "ready";
      sendJson(response, 200, {
        status,
        result_url: status === "ready" ? "/media/deep.mp4" : null,
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/api/explanations") {
      sendJson(response, 404, { error: { code: "not_found", message: "" } });
      return;
    }

    const body = await readBody(request);
    const address = String(request.headers["x-forwarded-for"] ?? "");
    seen.push({
      question: body.question ?? "",
      language: body.language ?? "",
      level: body.level ?? "",
      address,
      acceptLanguage: String(request.headers["accept-language"] ?? ""),
    });
    const tag = /^\[([a-z-]+)(?::(\d+))?\]/.exec(body.question ?? "");
    const behaviour = tag?.[1] ?? "ok";
    const argument = Number(tag?.[2] ?? 1);
    const id = `exp-${(counter += 1)}`;

    switch (behaviour) {
      case "limited-once":
        if (!limited.has(address)) {
          limited.add(address);
          sendJson(
            response,
            429,
            { error: { code: "rate_limited", message: "" } },
            {
              "Retry-After": String(argument),
            },
          );
          return;
        }
        return explain(response, id, {});
      case "limited-always":
        sendJson(
          response,
          429,
          { error: { code: "rate_limited", message: "" } },
          {
            "Retry-After": String(tag?.[2] ?? 1),
          },
        );
        return;
      case "unavailable":
        sendJson(response, 503, {
          error: { code: "generation_unavailable", message: "" },
          references: [],
        });
        return;
      case "partial":
        return explain(response, id, { dropped: [2] });
      case "cache":
        return explain(response, id, { cached: true });
      case "deep":
      case "deep-abandoned":
      case "deep-stuck":
        deepKinds.set(id, behaviour);
        return explain(response, id, { deep: true });
      case "refused":
      case "clarify":
      case "error":
      case "cached-event":
      case "redirected":
      case "stall":
      case "cut":
        return interrupted(response, id, behaviour);
      default:
        return explain(response, id, { corrected: [1] });
    }
  }

  async function interrupted(
    response: ServerResponse,
    id: string,
    behaviour: string,
  ): Promise<void> {
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const emit = (sequence: number, name: string, data: object): void => {
      response.write(`id: ${sequence}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emit(1, "accepted", { explanation_id: id, cached: false });
    await wait(STEP_MS);
    if (behaviour === "refused") emit(2, "refused", { reason: "out of scope" });
    if (behaviour === "clarify") emit(2, "clarify", { reason: "too vague", interpretations: [] });
    if (behaviour === "error") emit(2, "error", { code: "generation_failed", message: "no" });
    if (behaviour === "cached-event") emit(2, "cached", { explanation_id: "exp-earlier" });
    if (behaviour === "cut") emit(2, "scene", { index: 0, scene: {} });
    if (behaviour === "redirected") {
      emit(2, "redirected", { reason: "unrelated_followup" });
      emit(3, "scene", { index: 0, scene: {} });
      emit(4, "done", { status: "ready", share_url: `/fr/e/${id}` });
    }
    if (behaviour !== "stall") response.end();
  }

  const server: Server = createServer((request, response) => {
    answer(request, response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    deepPolls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

let work: string;
let fake: Fake;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "golden-"));
  fake = await startFake();
});

afterEach(async () => {
  await fake.close();
  await rm(work, { recursive: true, force: true });
});

function entry(id: string, behaviour: string, kind: Kind = "core"): object {
  return {
    id,
    subject: kind === "core" ? "maths" : "history",
    kind,
    level: "lycee",
    questions: {
      fr: `[${behaviour}] question ${id}`,
      en: `[${behaviour}] question ${id} in English`,
    },
  };
}

async function putSet(...entries: object[]): Promise<void> {
  await writeFile(path.join(work, "set.json"), JSON.stringify(entries));
}

async function golden(args: string[], options: { url?: string; set?: boolean } = {}) {
  const outcome = await run(
    process.execPath,
    [
      path.join(WEB, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(WEB, "scripts/tsconfig.json"),
      GOLDEN,
      `--base-url=${options.url ?? fake.url}`,
      ...(options.set === false ? [] : ["--set=set.json"]),
      "--out=report.json",
      ...args,
    ],
    { cwd: WEB, env: { ...process.env, INIT_CWD: work } },
  ).then(
    ({ stdout, stderr }): Outcome => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }): Outcome => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
  const report = await readFile(path.join(work, "report.json"), "utf8").then(
    (text) => JSON.parse(text) as Report,
    () => null,
  );
  return { ...outcome, report };
}

function result(overrides: Partial<QuestionResult> = {}): QuestionResult {
  return {
    id: "maths-test",
    kind: "core",
    subject: "maths",
    level: "lycee",
    language: "fr",
    question: "?",
    outcome: "ready",
    detail: null,
    explanation_id: "exp",
    cached: false,
    redirected: false,
    first_scene_ms: 5000,
    total_ms: 20_000,
    planned_scenes: 3,
    scenes: { validated: 3, corrected: 0, dropped: 0 },
    rate_limited: 0,
    waited_ms: 0,
    deep: null,
    ...overrides,
  };
}

function many(count: number, make: (index: number) => Partial<QuestionResult>): QuestionResult[] {
  return Array.from({ length: count }, (_, index) => result(make(index)));
}

describe("golden-set.json", () => {
  async function load() {
    return JSON.parse(await readFile(SET_FILE, "utf8")) as {
      id: string;
      subject: string;
      kind: string;
      level: string;
      questions: Record<string, string>;
    }[];
  }

  it("lists 30 concepts over the six subjects, five each, and 10 other school subjects", async () => {
    const set = await load();
    expect(set).toHaveLength(40);
    expect(new Set(set.map((item) => item.id)).size).toBe(40);
    const core = set.filter((item) => item.kind === "core");
    const other = set.filter((item) => item.kind === "other");
    expect(core).toHaveLength(30);
    expect(other).toHaveLength(10);
    for (const subject of SUBJECTS) {
      expect(core.filter((item) => item.subject === subject)).toHaveLength(5);
    }
    for (const item of other) expect(SUBJECTS).not.toContain(item.subject);
  });

  it("has a non-empty question in both languages and every level in each kind", async () => {
    const set = await load();
    for (const item of set) {
      expect(LEVELS).toContain(item.level);
      for (const language of LANGUAGES) {
        const question = item.questions[language]?.trim() ?? "";
        expect(question.length).toBeGreaterThan(0);
        expect(question.length).toBeLessThanOrEqual(500);
      }
    }
    for (const subject of SUBJECTS) {
      const levels = set.filter((item) => item.subject === subject).map((item) => item.level);
      expect(new Set(levels).size).toBeGreaterThanOrEqual(2);
    }
    for (const kind of ["core", "other"]) {
      const levels = set.filter((item) => item.kind === kind).map((item) => item.level);
      expect(new Set(levels)).toEqual(new Set(LEVELS));
    }
  });

  it("is accepted by the script and avoids the questions of the reference explanations", async () => {
    const concepts = parseSet(await readFile(SET_FILE, "utf8"));
    expect(concepts).toHaveLength(40);
    const references = JSON.parse(await readFile(REFERENCE_SET_FILE, "utf8")) as {
      questions: Record<string, string>;
    }[];
    const referenced = new Set(references.flatMap((item) => Object.values(item.questions)));
    for (const concept of concepts) {
      for (const language of LANGUAGES)
        expect(referenced).not.toContain(concept.questions[language]);
    }
  });

  it("uses the languages and levels of the scene package", () => {
    const questions = Object.fromEntries(LANGUAGES.map((language) => [language, "Question ?"]));
    for (const level of LEVELS) {
      expect(
        parseSet(JSON.stringify([{ ...entry("maths-a", "ok"), level, questions }])),
      ).toHaveLength(1);
    }
  });

  it("is refused when a concept is malformed", () => {
    const good = entry("maths-a", "ok");
    expect(() => parseSet(JSON.stringify([good, good]))).toThrow("en double");
    expect(() => parseSet(JSON.stringify([{ ...good, kind: "other" }]))).toThrow("six matières");
    expect(() => parseSet(JSON.stringify([{ ...good, subject: "history" }]))).toThrow(
      "six matières",
    );
    expect(() => parseSet(JSON.stringify([{ ...good, level: "x" }]))).toThrow("level");
    expect(() => parseSet(JSON.stringify([{ ...good, questions: { fr: "a", en: " " } }]))).toThrow(
      "questions.en",
    );
    expect(() => parseSet("[]")).toThrow("non vide");
  });
});

describe("statistics", () => {
  it("computes the median and the 90th percentile of known values", () => {
    const ten = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5];
    expect(median(ten)).toBe(5.5);
    expect(percentile(ten, 90)).toBe(9);
    const five = [8, 2, 10, 4, 6];
    expect(median(five)).toBe(6);
    expect(percentile(five, 90)).toBe(10);
    expect(percentile(five, 50)).toBe(6);
    expect(median([7])).toBe(7);
    expect(percentile([7], 90)).toBe(7);
    expect(median([])).toBeNull();
    expect(percentile([], 90)).toBeNull();
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(twenty, 90)).toBe(18);
    expect(median(twenty)).toBe(10.5);
  });

  it("summarises outcomes per kind, delays without the cache, and the scenes", () => {
    const summary = summarize([
      result({ first_scene_ms: 4000, scenes: { validated: 2, corrected: 1, dropped: 0 } }),
      result({
        first_scene_ms: 8000,
        outcome: "partial",
        scenes: { validated: 2, corrected: 0, dropped: 1 },
      }),
      result({ first_scene_ms: 100, cached: true }),
      result({
        first_scene_ms: null,
        outcome: "refused",
        scenes: { validated: 0, corrected: 0, dropped: 0 },
      }),
      result({ kind: "other", outcome: "timeout", first_scene_ms: null }),
    ]);
    expect(summary.kinds.core).toMatchObject({ total: 4, succeeded: 3, cached: 1 });
    expect(summary.kinds.core.counts).toMatchObject({ ready: 2, partial: 1, refused: 1 });
    expect(summary.kinds.other).toMatchObject({ total: 1, succeeded: 0 });
    expect(summary.kinds.other.counts.timeout).toBe(1);
    expect(summary.first_scene).toEqual({ count: 2, without: 2, median_ms: 6000, p90_ms: 8000 });
    expect(summary.scenes).toEqual({ validated: 10, corrected: 1, dropped: 1 });
    expect(summary.deep.announced).toBe(0);
  });

  it("holds the thresholds exactly at 90 %, 80 %, 15 s and 80 % of the deep versions", () => {
    const rates = (core: number, other: number) =>
      summarize([
        ...many(30, (index) => ({ outcome: index < core ? "ready" : "failed" })),
        ...many(10, (index) => ({ kind: "other", outcome: index < other ? "ready" : "refused" })),
      ]);
    expect(thresholdFailures(rates(27, 8))).toEqual([]);
    expect(thresholdFailures(rates(26, 8))[0]).toContain("aboutissement core : 26/30");
    expect(thresholdFailures(rates(27, 7))[0]).toContain("aboutissement other : 7/10");
    expect(thresholdFailures(rates(30, 10))).toEqual([]);

    const delay = (ms: number) =>
      summarize(many(10, (index) => ({ first_scene_ms: index === 9 ? ms : 1000 })));
    expect(thresholdFailures(delay(60_000))).toEqual([]);
    const slow = summarize(many(10, (index) => ({ first_scene_ms: index >= 8 ? 15_000 : 1000 })));
    expect(thresholdFailures(slow)[0]).toContain("90ᵉ centile à 15,0 s");
    const fast = summarize(many(10, (index) => ({ first_scene_ms: index >= 9 ? 15_000 : 14_999 })));
    expect(thresholdFailures(fast)).toEqual([]);

    const deep = (ready: number, total: number) =>
      summarize(
        many(total, (index) => ({
          deep: index < ready ? { status: "ready", ms: 120_000 } : { status: "timeout", ms: null },
        })),
      );
    expect(thresholdFailures(deep(4, 5))).toEqual([]);
    expect(thresholdFailures(deep(3, 5))[0]).toContain("version approfondie : 3/5");
    const late = summarize(many(1, () => ({ deep: { status: "ready", ms: 300_000 } })));
    expect(thresholdFailures(late)[0]).toContain("0/1");
    expect(late.deep).toMatchObject({
      announced: 1,
      ready: 1,
      within_limit: 0,
      median_ms: 300_000,
    });
  });
});

describe("golden script against a simulated server", { timeout: 60_000 }, () => {
  it("plays the first three questions of the set and prints a readable report", async () => {
    const outcome = await golden(["--limit", "3"], { set: false });
    expect(outcome.code).toBe(0);
    expect(fake.seen).toHaveLength(3);
    expect(fake.seen.map((item) => item.language)).toEqual(["fr", "fr", "fr"]);
    expect(fake.seen.map((item) => item.level)).toEqual(["college", "lycee", "lycee"]);
    expect(fake.seen[0]?.question).toBe("À quoi sert le théorème de Thalès ?");
    expect(fake.seen[0]?.acceptLanguage).toBe("fr");
    expect(new Set(fake.seen.map((item) => item.address)).size).toBe(3);

    expect(outcome.stdout).toMatch(
      /^Jeu de référence : 3 question\(s\) en fr, http:\/\/127\.0\.0\.1:\d+, concurrence 1/,
    );
    expect(outcome.stdout).toMatch(/id\s+langue\s+issue\s+1re scène\s+V\/C\/É\s+durée\s+note/);
    expect(outcome.stdout).toMatch(/maths-thales\s+fr\s+ready\s+\d,\d s\s+2\/1\/0\s+\d,\d s/);
    expect(outcome.stdout).toContain("maths-quadratic-equation");
    expect(outcome.stdout).toContain("maths-conditional-probability");
    expect(outcome.stdout).toContain("core  : 3/3 = 100,0 % (seuil 90 %) tenu");
    expect(outcome.stdout).toMatch(/médiane \d,\d s, 90ᵉ centile \d,\d s \(seuil < 15,0 s\) tenu/);
    expect(outcome.stdout).toContain("Scènes : validées 6, corrigées 3, écartées 0");
    expect(outcome.stdout).toContain("Coût : non disponible");
    expect(outcome.stdout).toContain("Version approfondie : aucune annoncée");
    expect(outcome.stdout).toContain("Seuils : tous tenus.");
    expect(outcome.stderr).toContain("[3/3] maths-conditional-probability fr : ready");
    expect(outcome.report?.results).toHaveLength(3);
  });

  it("filters by kind, id and language, and takes the limit after the languages", async () => {
    const both = await golden(["--lang=both", "--only=maths-thales"], { set: false });
    expect(both.code).toBe(0);
    expect(fake.seen.map((item) => [item.language, item.question])).toEqual([
      ["fr", "À quoi sert le théorème de Thalès ?"],
      ["en", "What is Thales's theorem for?"],
    ]);
    expect(fake.seen.map((item) => item.acceptLanguage)).toEqual(["fr", "en"]);

    fake.seen.length = 0;
    const other = await golden(["--kind=other", "--lang=en", "--limit=3"], { set: false });
    expect(other.code).toBe(0);
    expect(other.report?.results.map((item) => item.id)).toEqual([
      "history-french-revolution",
      "history-cold-war",
      "geography-climate-zones",
    ]);
    expect(other.stdout).toContain("other : 3/3 = 100,0 % (seuil 80 %) tenu");
    expect(other.stdout).not.toContain("core ");

    fake.seen.length = 0;
    const limited = await golden(["--lang=both", "--limit=3"], { set: false });
    expect(limited.report?.results.map((item) => `${item.id} ${item.language}`)).toEqual([
      "maths-thales fr",
      "maths-thales en",
      "maths-quadratic-equation fr",
    ]);
  });

  it("classifies every kind of ending and counts the scenes", async () => {
    await putSet(
      entry("t-ready", "ok"),
      entry("t-partial", "partial"),
      entry("t-refused", "refused"),
      entry("t-clarify", "clarify"),
      entry("t-error", "error"),
      entry("t-cache", "cache"),
      entry("t-cached-event", "cached-event"),
      entry("t-redirected", "redirected"),
      entry("t-cut", "cut"),
      entry("t-unavailable", "unavailable"),
    );
    const outcome = await golden(["--concurrency=5"]);
    expect(outcome.code).toBe(1);
    const byId = new Map(outcome.report?.results.map((item) => [item.id, item]));
    expect(byId.get("t-ready")).toMatchObject({
      outcome: "ready",
      scenes: { validated: 2, corrected: 1, dropped: 0 },
      planned_scenes: 3,
    });
    expect(byId.get("t-partial")).toMatchObject({
      outcome: "partial",
      scenes: { validated: 2, corrected: 0, dropped: 1 },
    });
    expect(byId.get("t-refused")).toMatchObject({ outcome: "refused", detail: "out of scope" });
    expect(byId.get("t-clarify")).toMatchObject({ outcome: "clarify", detail: "too vague" });
    expect(byId.get("t-error")).toMatchObject({ outcome: "failed", detail: "generation_failed" });
    expect(byId.get("t-cache")).toMatchObject({ outcome: "ready", cached: true });
    expect(byId.get("t-cached-event")).toMatchObject({
      outcome: "ready",
      cached: true,
      explanation_id: "exp-earlier",
    });
    expect(byId.get("t-redirected")).toMatchObject({ outcome: "ready", redirected: true });
    expect(byId.get("t-cut")).toMatchObject({ outcome: "failed", detail: "connection_lost" });
    expect(byId.get("t-unavailable")).toMatchObject({
      outcome: "failed",
      detail: "generation_unavailable",
    });

    const { summary } = outcome.report!;
    expect(summary.kinds.core.counts).toEqual({
      ready: 4,
      partial: 1,
      refused: 1,
      clarify: 1,
      failed: 3,
      timeout: 0,
    });
    expect(summary.kinds.core.cached).toBe(2);
    expect(summary.first_scene.count).toBe(4);
    expect(outcome.stdout).toContain("dont 2 servie(s) par le cache");
    expect(outcome.stdout).toMatch(/t-redirected\s+fr\s+ready.*redirigée/);
    expect(outcome.stdout).toMatch(/t-cache\s+fr\s+ready.*cache/);
    expect(outcome.stdout).toMatch(/t-unavailable\s+fr\s+failed.*generation_unavailable/);
    expect(outcome.stdout).toContain("Seuils non tenus :");
    expect(outcome.stdout).toContain("aboutissement core : 5/10");
  });

  it("exits with 0 at exactly 90 % on the core concepts and 80 % on the others", async () => {
    await putSet(
      ...Array.from({ length: 10 }, (_, index) =>
        entry(`c-${index}`, index === 0 ? "refused" : "ok"),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        entry(`o-${index}`, index === 0 ? "refused" : "ok", "other"),
      ),
    );
    const held = await golden(["--concurrency=5"]);
    expect(held.code).toBe(0);
    expect(held.stdout).toContain("core  : 9/10 = 90,0 % (seuil 90 %) tenu");
    expect(held.stdout).toContain("other : 4/5 = 80,0 % (seuil 80 %) tenu");
    expect(held.stdout).toContain("refused 1");

    await putSet(
      ...Array.from({ length: 10 }, (_, index) =>
        entry(`c-${index}`, index < 2 ? "refused" : "ok"),
      ),
    );
    const missed = await golden(["--concurrency=5"]);
    expect(missed.code).toBe(1);
    expect(missed.stdout).toContain("core  : 8/10 = 80,0 % (seuil 90 %) NON TENU");
    expect(missed.report?.threshold_failures).toHaveLength(1);

    await putSet(
      ...Array.from({ length: 5 }, (_, index) =>
        entry(`o-${index}`, index < 2 ? "clarify" : "ok", "other"),
      ),
    );
    const others = await golden(["--concurrency=5"]);
    expect(others.code).toBe(1);
    expect(others.stdout).toContain("other : 3/5 = 60,0 % (seuil 80 %) NON TENU");
  });

  it("stops waiting for a question after --timeout and counts it as a timeout", async () => {
    await putSet(entry("t-stall", "stall"), entry("t-ready", "ok"));
    const started = Date.now();
    const outcome = await golden(["--timeout=1", "--concurrency=2"]);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(outcome.code).toBe(1);
    const stalled = outcome.report?.results.find((item) => item.id === "t-stall");
    expect(stalled).toMatchObject({ outcome: "timeout", first_scene_ms: null });
    expect(stalled?.total_ms).toBeGreaterThanOrEqual(900);
    expect(stalled?.total_ms).toBeLessThan(5000);
    expect(outcome.report?.results.find((item) => item.id === "t-ready")?.outcome).toBe("ready");
    expect(outcome.stdout).toMatch(/t-stall\s+fr\s+timeout/);
    expect(outcome.stdout).toContain("1 sans aucune scène");
    expect(outcome.stdout).toContain("timeout 1");
  });

  it("waits for Retry-After on a 429, retries with the same visitor address, then counts the result", async () => {
    await putSet(entry("t-limited", "limited-once:1"));
    const outcome = await golden([]);
    expect(outcome.code).toBe(0);
    expect(fake.seen).toHaveLength(2);
    expect(fake.seen[1]?.address).toBe(fake.seen[0]?.address);
    const [limited] = outcome.report!.results;
    expect(limited).toMatchObject({ outcome: "ready", rate_limited: 1 });
    expect(limited?.waited_ms).toBe(1000);
    expect(limited?.first_scene_ms).toBeLessThan(1000);
    expect(outcome.stdout).toMatch(/t-limited\s+fr\s+ready.*429×1/);
  });

  it("gives up on a 429 that stays: after the retries, or at once when the wait is too long", async () => {
    await putSet(entry("t-short", "limited-always:0"));
    const exhausted = await golden([]);
    expect(exhausted.code).toBe(1);
    expect(fake.seen).toHaveLength(4);
    expect(exhausted.report?.results[0]).toMatchObject({
      outcome: "failed",
      detail: "rate_limited",
      rate_limited: 4,
    });

    fake.seen.length = 0;
    await putSet(entry("t-long", "limited-always:3600"));
    const long = await golden(["--timeout=5"]);
    expect(long.code).toBe(1);
    expect(fake.seen).toHaveLength(1);
    expect(long.report?.results[0]).toMatchObject({
      outcome: "failed",
      detail: "rate_limited",
      waited_ms: 0,
    });
  });

  it("sends a different visitor address with every question, without touching the rate limit", async () => {
    await putSet(...Array.from({ length: 8 }, (_, index) => entry(`t-${index}`, "refused")));
    const outcome = await golden(["--concurrency=4"]);
    expect(outcome.code).toBe(1);
    const addresses = fake.seen.map((item) => item.address);
    expect(addresses).toHaveLength(8);
    expect(new Set(addresses).size).toBe(8);
    for (const address of addresses) expect(address).toMatch(/^10\.\d+\.\d+\.\d+$/);
  });

  it("follows the deep version and reports how long it took, up to the deep timeout", async () => {
    await putSet(entry("t-deep", "deep"));
    const ready = await golden(["--deep-poll=0.1"]);
    expect(ready.code).toBe(0);
    const [only] = ready.report!.results;
    expect(only?.deep?.status).toBe("ready");
    expect(only?.deep?.ms).toBeGreaterThanOrEqual(150);
    expect(only?.deep?.ms).toBeLessThan(5000);
    expect(fake.deepPolls.get(only!.explanation_id!)).toBe(3);
    expect(ready.stdout).toMatch(/t-deep\s+fr\s+ready.*approfondie \d,\d s/);
    expect(ready.stdout).toContain("Version approfondie : 1 annoncée(s), 1 prête(s)");
    expect(ready.stderr).toContain("En attente de 1 version(s) approfondie(s)");

    await putSet(
      entry("t-ok", "deep"),
      entry("t-gone", "deep-abandoned"),
      entry("t-stuck", "deep-stuck"),
    );
    const mixed = await golden(["--deep-poll=0.1", "--deep-timeout=1", "--concurrency=3"]);
    expect(mixed.code).toBe(1);
    const status = new Map(mixed.report?.results.map((item) => [item.id, item.deep?.status]));
    expect(status.get("t-ok")).toBe("ready");
    expect(status.get("t-gone")).toBe("abandoned");
    expect(status.get("t-stuck")).toBe("timeout");
    expect(mixed.stdout).toContain("approfondie abandonnée");
    expect(mixed.stdout).toContain("approfondie hors délai");
    expect(mixed.report?.threshold_failures[0]).toContain("version approfondie : 1/3");
  });

  it("reports a server that cannot be reached as failed questions", async () => {
    await putSet(entry("t-down", "ok"));
    const closed = await startFake();
    await closed.close();
    const outcome = await golden([], { url: closed.url });
    expect(outcome.code).toBe(1);
    expect(outcome.report?.results[0]).toMatchObject({ outcome: "failed", detail: "ECONNREFUSED" });
  });

  it("rejects wrong options and a set that does not parse, with exit code 2", async () => {
    await putSet(entry("t-ready", "ok"));
    const language = await golden(["--lang=de"]);
    expect(language.code).toBe(2);
    expect(language.stderr).toContain("--lang doit valoir fr, en ou both");

    const kind = await golden(["--kind=weird"]);
    expect(kind.code).toBe(2);

    const concept = await golden(["--only=unknown"]);
    expect(concept.code).toBe(2);
    expect(concept.stderr).toContain("Aucune question ne correspond");

    const limit = await golden(["--limit=0"]);
    expect(limit.code).toBe(2);
    expect(limit.stderr).toContain("--limit doit être un nombre entier positif");

    const address = await golden([], { url: "localhost:3000" });
    expect(address.code).toBe(2);
    expect(address.stderr).toContain("--base-url");

    await writeFile(path.join(work, "set.json"), JSON.stringify([{ id: "x" }]));
    const broken = await golden([]);
    expect(broken.code).toBe(2);
    expect(broken.stderr).toContain("concept 1");
    expect(fake.seen).toHaveLength(0);
  });
});
