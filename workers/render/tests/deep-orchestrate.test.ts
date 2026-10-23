import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureProvider,
  LlmError,
  type GenerateRequest,
  type LlmProvider,
  type ScenarioStep,
} from "@/server/llm";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import { AUTHOR_TIMEOUT_MS, renderDeepVersion, type DeepOutcome } from "../src/deep/orchestrate";
import { DEEP_EXAMPLE, DEEP_REPAIR_MARKER, DEEP_WRITE_MARKER } from "../src/deep/prompt";
import { createSandbox, type Sandbox } from "../src/deep/sandbox";
import {
  derivativeRecord,
  FAKE_MP4,
  loadGravity,
  scratchDir,
  startFakeSandbox,
  waitFor,
  type FakeAnswer,
  type FakeSandbox,
} from "./helpers/support";

const MINUTE = 60_000;
const STATIC_BROKEN = `import os\n${DEEP_EXAMPLE}`;
const RENDER_BROKEN = `${DEEP_EXAMPLE}        raise ValueError("the tangent was never drawn")\n`;
const VIOLATION =
  "line 1: import os is not allowed: use from manim import ..., import numpy or import math";
const TRACEBACK = [
  "Traceback (most recent call last):",
  '  File "scene.py", line 33, in construct',
  "ValueError: the tangent was never drawn",
].join("\n");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function answerFor(code: string): FakeAnswer {
  if (code.startsWith("import os")) return { ok: false, stage: "static_check", error: VIOLATION };
  if (code.includes("raise ValueError")) {
    return {
      ok: false,
      stage: "render",
      error: "the render failed with exit code 1",
      stderr_tail: TRACEBACK,
    };
  }
  return { ok: true };
}

const write = (code: string, extra: Partial<ScenarioStep> = {}): ScenarioStep => ({
  role: "author",
  when: DEEP_WRITE_MARKER,
  response: { code },
  ...extra,
});
const repair = (code: string, extra: Partial<ScenarioStep> = {}): ScenarioStep => ({
  role: "author",
  when: DEEP_REPAIR_MARKER,
  response: { code },
  ...extra,
});

describe("deep version orchestration", () => {
  let record: ExplanationRecord;
  let root: string;
  let dir: string;
  let mediaDir: string;
  let fake: FakeSandbox | undefined;
  let lines: string[];

  beforeAll(async () => {
    record = derivativeRecord(await loadGravity());
  });

  beforeEach(async () => {
    root = await scratchDir("deep-orchestrate");
    dir = path.join(root, "sandbox");
    mediaDir = path.join(root, "media");
    lines = [];
  });

  afterEach(async () => {
    await fake?.stop();
    fake = undefined;
    await rm(root, { recursive: true, force: true });
  });

  function recording(
    provider: LlmProvider,
    before?: (request: GenerateRequest<unknown>) => Promise<void>,
  ) {
    const requests: GenerateRequest<unknown>[] = [];
    const llm: LlmProvider = {
      ...provider,
      generateObject: async <T>(request: GenerateRequest<T>) => {
        requests.push(request as GenerateRequest<unknown>);
        await before?.(request as GenerateRequest<unknown>);
        return provider.generateObject(request);
      },
    };
    return { llm, requests };
  }

  function scripted(
    steps: ScenarioStep[],
    before?: (request: GenerateRequest<unknown>) => Promise<void>,
  ) {
    const question = record.title!;
    return recording(createFixtureProvider([{ name: "deep", question, steps }]), before);
  }

  async function serve(
    answer: (code: string) => FakeAnswer | Promise<FakeAnswer> = answerFor,
    now?: () => number,
  ) {
    fake = await startFakeSandbox({ dir, answer, ...(now ? { now } : {}) });
    return fake;
  }

  function run(
    llm: LlmProvider,
    options: { now?: () => number; signal?: AbortSignal; sandbox?: Sandbox } = {},
  ) {
    const progress: number[] = [];
    const outcome = renderDeepVersion({
      record,
      llm,
      sandbox:
        options.sandbox ?? createSandbox({ dir, ...(options.now ? { now: options.now } : {}) }),
      mediaDir,
      pollMs: 10,
      log: (line) => lines.push(line),
      onProgress: (percent) => progress.push(percent),
      ...(options.now ? { now: options.now } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return { outcome, progress };
  }

  const target = () => path.join(mediaDir, record.id, "deep.mp4");

  async function leftovers(): Promise<string[]> {
    const inbox = await readdir(path.join(dir, "in"));
    const outbox = (await readdir(path.join(dir, "out"))).filter(
      (name) => !name.includes(".heartbeat"),
    );
    return [...inbox, ...outbox];
  }

  function userText(request: GenerateRequest<unknown>): string {
    return request.messages.map((message) => message.content).join("\n");
  }

  it("writes, renders and moves the video at the first attempt", async () => {
    const sandbox = await serve();
    const { llm, requests } = scripted([write(DEEP_EXAMPLE)]);
    const { outcome, progress } = run(llm);

    expect(await outcome).toEqual({ status: "succeeded", file: target(), attempts: 1 });
    expect(await readFile(target())).toEqual(FAKE_MP4);
    expect(await readdir(path.dirname(target()))).toEqual(["deep.mp4"]);
    expect(await leftovers()).toEqual([]);
    expect(sandbox.seen).toEqual([{ id: expect.stringMatching(/^deep-/), code: DEEP_EXAMPLE }]);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ role: "author", traceId: `deep:${record.id}` });
    expect(requests[0]!.timeoutMs).toBeLessThanOrEqual(AUTHOR_TIMEOUT_MS);
    expect(userText(requests[0]!)).toContain(DEEP_WRITE_MARKER);

    expect(progress.slice(0, 3)).toEqual([5, 20, 25]);
    expect(progress.at(-1)).toBe(95);
    expect(progress).toEqual([...new Set(progress)].sort((a, b) => a - b));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/succeeded after 1 attempt\(s\) in \d+\.\d s: #1 write/);
    expect(lines[0]).not.toContain("def construct");
  });

  it("sends a static refusal back for repair, with the previous file, then succeeds", async () => {
    const sandbox = await serve();
    const { llm, requests } = scripted([write(STATIC_BROKEN), repair(DEEP_EXAMPLE)]);

    expect(await run(llm).outcome).toMatchObject({ status: "succeeded", attempts: 2 });

    expect(sandbox.seen.map((job) => job.code)).toEqual([STATIC_BROKEN, DEEP_EXAMPLE]);
    expect(new Set(sandbox.seen.map((job) => job.id)).size).toBe(2);
    const asked = userText(requests[1]!);
    expect(asked).toContain(DEEP_REPAIR_MARKER);
    expect(asked).toContain(`<previous_code>\n${STATIC_BROKEN.trim()}\n</previous_code>`);
    expect(asked).toMatch(
      /<untrusted_sandbox_report stage="static_check">[^]*line 1: import os is not allowed[^]*<\/untrusted_sandbox_report>/,
    );
    expect(lines[0]).toMatch(/#1 write .*static_check failed .*\(line 1: import os is not allowed/);
    expect(lines[0]).not.toContain("def construct");
    expect(await readFile(target())).toEqual(FAKE_MP4);
    expect(await leftovers()).toEqual([]);
  });

  it("sends a failed render back for repair with the end of its output", async () => {
    await serve();
    const { llm, requests } = scripted([write(RENDER_BROKEN), repair(DEEP_EXAMPLE)]);

    expect(await run(llm).outcome).toMatchObject({ status: "succeeded", attempts: 2 });

    const asked = userText(requests[1]!);
    expect(asked).toMatch(
      /<untrusted_sandbox_report stage="render">[^]*ValueError: the tangent was never drawn[^]*<\/untrusted_sandbox_report>/,
    );
    expect(lines[0]).not.toContain("Traceback");
  });

  it("abandons after three failed attempts, with a short technical reason", async () => {
    const sandbox = await serve();
    const { llm, requests } = scripted([
      write(STATIC_BROKEN),
      repair(RENDER_BROKEN, { repeat: true }),
    ]);

    const outcome = await run(llm).outcome;

    expect(outcome).toEqual({
      status: "abandoned",
      reason: "attempts_exhausted (render)",
      attempts: 3,
    });
    expect(requests).toHaveLength(3);
    expect(sandbox.seen).toHaveLength(3);
    expect(await stat(target()).catch(() => null)).toBeNull();
    expect(await leftovers()).toEqual([]);
    expect(lines[0]).toMatch(/abandoned \(attempts_exhausted \(render\)\) after 3 attempt/);
  });

  it("abandons when the six minutes run out between two attempts", async () => {
    let clock = Date.parse("2026-10-23T10:00:00Z");
    const now = () => clock;
    const sandbox = await serve(answerFor, now);
    const { llm, requests } = scripted(
      [write(STATIC_BROKEN), repair(STATIC_BROKEN, { repeat: true })],
      async () => {
        clock += 2.5 * MINUTE;
        await delay(40);
      },
    );

    const outcome = await run(llm, { now }).outcome;

    expect(outcome).toEqual({ status: "abandoned", reason: "time_limit", attempts: 3 });
    expect(requests).toHaveLength(3);
    expect(requests[2]!.timeoutMs).toBe(1 * MINUTE);
    expect(sandbox.seen).toHaveLength(2);
    expect(await leftovers()).toEqual([]);
  });

  it("abandons when the six minutes run out while the render is awaited", async () => {
    const began = Date.now();
    const start = Date.parse("2026-10-23T10:00:00Z");
    const now = () => start + (Date.now() - began) * 600;
    const sandbox = await serve(() => "silent", now);
    const { llm } = scripted([write(DEEP_EXAMPLE)]);
    const { outcome, progress } = run(llm, { now });

    expect(await outcome).toEqual({ status: "abandoned", reason: "time_limit", attempts: 1 });
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(sandbox.seen).toHaveLength(1);
    expect(await leftovers()).toEqual([]);
    expect(Math.max(...progress)).toBeGreaterThan(25);
    expect(Math.max(...progress)).toBeLessThanOrEqual(90);
  });

  it("counts a failure of the language model as an attempt", async () => {
    const sandbox = await serve();
    const { llm, requests } = scripted([write("", { error: "timeout" }), write(DEEP_EXAMPLE)]);

    expect(await run(llm).outcome).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(requests).toHaveLength(2);
    expect(sandbox.seen).toHaveLength(1);
    expect(lines[0]).toMatch(/#1 write failed \(timeout\)/);
  });

  it("abandons when the language model never answers, without depositing anything", async () => {
    const sandbox = await serve();
    const { llm, requests } = scripted([write("", { error: "unavailable", repeat: true })]);

    expect(await run(llm).outcome).toEqual({
      status: "abandoned",
      reason: "attempts_exhausted (author_unavailable)",
      attempts: 3,
    });
    expect(requests).toHaveLength(3);
    expect(sandbox.seen).toHaveLength(0);
  });

  it("asks again within the attempt when the reply has no code, and strips markdown fences", async () => {
    const sandbox = await serve();
    const { llm } = scripted([
      { role: "author", when: DEEP_WRITE_MARKER, response: { text: "Voici le code." } },
      write(`\`\`\`python\n${DEEP_EXAMPLE}\`\`\``),
    ]);

    expect(await run(llm).outcome).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(sandbox.seen.map((job) => job.code)).toEqual([DEEP_EXAMPLE]);
  });

  it("abandons at once, without asking the model, when the sandbox gives no sign of life", async () => {
    await mkdir(path.join(dir, "in"), { recursive: true });
    await mkdir(path.join(dir, "out"), { recursive: true });
    const { llm, requests } = scripted([write(DEEP_EXAMPLE)]);

    expect(await run(llm).outcome).toEqual({
      status: "abandoned",
      reason: "sandbox_unavailable",
      attempts: 0,
    });
    expect(requests).toHaveLength(0);
    expect(await readdir(path.join(dir, "in"))).toEqual([]);
  });

  it("stops on cancellation while the render is awaited, without abandoning, and cleans up", async () => {
    const sandbox = await serve(() => "silent");
    const { llm } = scripted([write(DEEP_EXAMPLE)]);
    const controller = new AbortController();
    const { outcome } = run(llm, { signal: controller.signal });

    await waitFor(async () => sandbox.seen.length === 1);
    controller.abort();

    expect(await outcome).toEqual({ status: "cancelled", attempts: 1 });
    expect(await leftovers()).toEqual([]);
    expect(await stat(path.dirname(target())).catch(() => null)).toBeNull();
  });

  it("stops on cancellation while the model writes, before depositing anything", async () => {
    const sandbox = await serve();
    const controller = new AbortController();
    const waiting: LlmProvider = {
      name: "waiting",
      modelFor: () => "waiting",
      health: async () => ({ ok: true, latencyMs: 0 }),
      generateObject: (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(new LlmError("unavailable", "author", "The request was cancelled.")),
          );
        }),
    };
    const { outcome } = run(waiting, { signal: controller.signal });
    await delay(50);
    controller.abort();

    expect(await outcome).toEqual({ status: "cancelled", attempts: 1 });
    expect(sandbox.seen).toHaveLength(0);
  });

  it("abandons a video that is not a plain file of a sane size", async () => {
    await serve(() => ({ ok: true, video: Buffer.from("not an mp4 at all") }));
    const { llm } = scripted([write(DEEP_EXAMPLE)]);

    const outcome: DeepOutcome = await run(llm).outcome;

    expect(outcome).toEqual({ status: "abandoned", reason: "invalid_video", attempts: 1 });
    expect(await stat(target()).catch(() => null)).toBeNull();
    expect(await leftovers()).toEqual([]);
  });
});
