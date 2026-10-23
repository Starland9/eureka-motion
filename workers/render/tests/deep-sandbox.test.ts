import { watch, type FSWatcher } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSandbox,
  JOB_ID,
  MAX_VIDEO_BYTES,
  SandboxError,
  type Sandbox,
} from "../src/deep/sandbox";
import {
  FAKE_MP4,
  scratchDir,
  startFakeSandbox,
  waitFor,
  type FakeAnswer,
  type FakeSandbox,
} from "./helpers/support";

const SECOND = 1000;
const CODE =
  "from manim import *\n\n\nclass Quick(Scene):\n    def construct(self):\n        self.wait(1)\n";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function failure(promise: Promise<unknown>): Promise<SandboxError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SandboxError);
  return error as SandboxError;
}

describe("sandbox client", () => {
  let root: string;
  let dir: string;
  let inbox: string;
  let outbox: string;
  let mediaDir: string;
  let sandbox: Sandbox;
  let fake: FakeSandbox | undefined;
  let watcher: FSWatcher | undefined;

  beforeEach(async () => {
    root = await scratchDir("deep-sandbox");
    dir = path.join(root, "sandbox");
    inbox = path.join(dir, "in");
    outbox = path.join(dir, "out");
    mediaDir = path.join(root, "media");
    await mkdir(inbox, { recursive: true });
    await mkdir(outbox, { recursive: true });
    sandbox = createSandbox({ dir });
  });

  afterEach(async () => {
    watcher?.close();
    watcher = undefined;
    await fake?.stop();
    fake = undefined;
    await rm(root, { recursive: true, force: true });
  });

  async function beat(ageMs = 0): Promise<void> {
    await writeFile(
      path.join(outbox, ".heartbeat"),
      String(Math.floor((Date.now() - ageMs) / 1000)),
    );
  }

  async function serve(answer: (code: string) => FakeAnswer | Promise<FakeAnswer>) {
    fake = await startFakeSandbox({ dir, answer });
    return fake;
  }

  async function names(folder: string): Promise<string[]> {
    return (await readdir(folder)).sort();
  }

  it("deposits each file atomically, under a fresh id", async () => {
    await beat();
    const seen: [string, string][] = [];
    watcher = watch(inbox, (event, name) => {
      if (name) seen.push([event, name.toString()]);
    });

    const first = await sandbox.submit(CODE);
    const second = await sandbox.submit(`${CODE}# second\n`);
    await delay(50);

    expect(first.id).toMatch(JOB_ID);
    expect(second.id).toMatch(JOB_ID);
    expect(first.id).not.toBe(second.id);
    expect(await names(inbox)).toEqual([`${first.id}.py`, `${second.id}.py`].sort());
    expect(await readFile(path.join(inbox, `${first.id}.py`), "utf8")).toBe(CODE);
    const events = seen.filter(([, name]) => name.includes(first.id));
    expect(events[0]).toEqual(["rename", `.${first.id}.part`]);
    expect(events.filter(([, name]) => name === `${first.id}.py`)).toEqual([
      ["rename", `${first.id}.py`],
    ]);
  });

  it("refuses to deposit anything when the sandbox gives no sign of life", async () => {
    expect(await sandbox.alive()).toBe(false);
    expect((await failure(sandbox.submit(CODE))).code).toBe("sandbox_unavailable");

    await beat(61 * SECOND);
    expect(await sandbox.alive()).toBe(false);
    expect((await failure(sandbox.submit(CODE))).code).toBe("sandbox_unavailable");

    await writeFile(path.join(outbox, ".heartbeat"), "soon");
    expect(await sandbox.alive()).toBe(false);

    await rm(path.join(outbox, ".heartbeat"));
    await writeFile(path.join(root, "beat"), String(Math.floor(Date.now() / 1000)));
    await symlink(path.join(root, "beat"), path.join(outbox, ".heartbeat"));
    expect(await sandbox.alive()).toBe(false);

    expect(await names(inbox)).toEqual([]);
    await rm(path.join(outbox, ".heartbeat"));
    await beat(30 * SECOND);
    expect(await sandbox.alive()).toBe(true);
  });

  it("waits for the result the sandbox writes last", async () => {
    await serve(async () => {
      await delay(80);
      return { ok: true };
    });
    let polls = 0;
    const { id } = await sandbox.submit(CODE);
    const result = await sandbox.awaitResult(id, {
      deadline: Date.now() + 10 * SECOND,
      pollMs: 10,
      onPoll: () => (polls += 1),
    });

    expect(result).toEqual({
      ok: true,
      stage: "render",
      duration_ms: 12,
      error: "",
      stderr_tail: "",
    });
    expect(polls).toBeGreaterThan(0);
    expect(fake!.seen).toEqual([{ id, code: CODE }]);
    expect(await names(inbox)).toEqual([]);
  });

  it("hands a refusal back as the sandbox wrote it", async () => {
    await serve(() => ({
      ok: false,
      stage: "static_check",
      error: "line 1: import os is not allowed",
    }));
    const { id } = await sandbox.submit(`import os\n${CODE}`);
    const result = await sandbox.awaitResult(id, {
      deadline: Date.now() + 10 * SECOND,
      pollMs: 10,
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "static_check",
      error: "line 1: import os is not allowed",
    });
  });

  it("stops waiting at the deadline and when it is cancelled", async () => {
    await serve(() => "silent");
    const { id } = await sandbox.submit(CODE);
    const timedOut = await failure(
      sandbox.awaitResult(id, { deadline: Date.now() + 60, pollMs: 10 }),
    );
    expect(timedOut.code).toBe("timeout");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const began = Date.now();
    const cancelled = await failure(
      sandbox.awaitResult(id, {
        deadline: Date.now() + 60 * SECOND,
        pollMs: 5 * SECOND,
        signal: controller.signal,
      }),
    );
    expect(cancelled.code).toBe("cancelled");
    expect(Date.now() - began).toBeLessThan(2 * SECOND);
  });

  it("notices a sandbox that stops beating while it waits", async () => {
    const running = await serve(() => "silent");
    const { id } = await sandbox.submit(CODE);
    const waiting = failure(
      sandbox.awaitResult(id, { deadline: Date.now() + 60 * SECOND, pollMs: 10 }),
    );
    await waitFor(async () => running.seen.length === 1);
    running.beating = false;
    await beat(61 * SECOND);
    expect((await waiting).code).toBe("sandbox_unavailable");
  });

  it("refuses a result that is unreadable, of the wrong shape or not a regular file", async () => {
    await beat();
    await writeFile(path.join(outbox, "broken.json"), '{"ok": tru');
    expect(
      (
        await failure(
          sandbox.awaitResult("broken", { deadline: Date.now() + 10 * SECOND, pollMs: 5 }),
        )
      ).code,
    ).toBe("invalid_result");

    await writeFile(
      path.join(outbox, "shape.json"),
      JSON.stringify({ ok: "yes", stage: "render" }),
    );
    expect(
      (
        await failure(
          sandbox.awaitResult("shape", { deadline: Date.now() + 10 * SECOND, pollMs: 5 }),
        )
      ).code,
    ).toBe("invalid_result");

    await writeFile(
      path.join(root, "elsewhere.json"),
      JSON.stringify({ ok: true, stage: "render" }),
    );
    await symlink(path.join(root, "elsewhere.json"), path.join(outbox, "linked.json"));
    expect(
      (
        await failure(
          sandbox.awaitResult("linked", { deadline: Date.now() + 10 * SECOND, pollMs: 5 }),
        )
      ).code,
    ).toBe("invalid_result");
  });

  it("copies the video into the media directory, then clears the outbox", async () => {
    await beat();
    await writeFile(path.join(outbox, "job-1.mp4"), FAKE_MP4);
    await writeFile(path.join(outbox, "job-1.json"), "{}");
    await writeFile(path.join(outbox, "job-2.mp4"), FAKE_MP4);
    const destination = path.join(mediaDir, "abcdefghijkl", "deep.mp4");

    await sandbox.collect("job-1", destination);

    expect(await readFile(destination)).toEqual(FAKE_MP4);
    expect(await names(path.dirname(destination))).toEqual(["deep.mp4"]);
    expect(await names(outbox)).toEqual([".heartbeat", "job-2.mp4"]);
  });

  it("never follows a symbolic link in place of the video", async () => {
    const secret = path.join(root, "secret.mp4");
    await writeFile(secret, FAKE_MP4);
    await symlink(secret, path.join(outbox, "job-1.mp4"));
    const destination = path.join(mediaDir, "abcdefghijkl", "deep.mp4");

    const refused = await failure(sandbox.collect("job-1", destination));

    expect(refused.code).toBe("invalid_video");
    expect(refused.message).toMatch(/symbolic link/);
    expect(await stat(destination).catch(() => null)).toBeNull();
    expect(await readFile(secret)).toEqual(FAKE_MP4);

    await mkdir(path.join(outbox, "job-2.mp4"));
    expect((await failure(sandbox.collect("job-2", destination))).code).toBe("invalid_video");
  });

  it("refuses a video that is empty, not an MP4 or larger than 100 MB", async () => {
    const destination = path.join(mediaDir, "abcdefghijkl", "deep.mp4");
    const huge = await open(path.join(outbox, "huge.mp4"), "w");
    await huge.write(FAKE_MP4, 0, FAKE_MP4.length, 0);
    await huge.truncate(MAX_VIDEO_BYTES + 1);
    await huge.close();
    await writeFile(path.join(outbox, "empty.mp4"), "");
    await writeFile(path.join(outbox, "text.mp4"), "this is not a video at all");

    for (const id of ["huge", "empty", "text"]) {
      expect((await failure(sandbox.collect(id, destination))).code).toBe("invalid_video");
    }
    expect(await stat(path.dirname(destination)).catch(() => null)).toBeNull();
  });

  it("removes every file of a job, and only those", async () => {
    for (const name of ["job-1.py", ".job-1.part", "job-2.py"]) {
      await writeFile(path.join(inbox, name), CODE);
    }
    for (const name of ["job-1.json", "job-1.mp4", "job-2.json", ".heartbeat"]) {
      await writeFile(path.join(outbox, name), "x");
    }

    await sandbox.cleanup("job-1");
    await sandbox.cleanup("job-3");

    expect(await names(inbox)).toEqual(["job-2.py"]);
    expect(await names(outbox)).toEqual([".heartbeat", "job-2.json"]);
  });

  it("refuses an id that could leave its directory", async () => {
    for (const id of ["../media/x", "a/b", "..", "", "x".repeat(65)]) {
      await expect(sandbox.cleanup(id)).rejects.toThrow(/Invalid sandbox job id/);
      await expect(sandbox.collect(id, path.join(mediaDir, "deep.mp4"))).rejects.toThrow(
        /Invalid sandbox job id/,
      );
      await expect(sandbox.awaitResult(id, { deadline: Date.now() + 100 })).rejects.toThrow(
        /Invalid sandbox job id/,
      );
    }
    const unsafe = createSandbox({ dir, newId: () => "../escape" });
    await beat();
    await expect(unsafe.submit(CODE)).rejects.toThrow(/Invalid sandbox job id/);
    expect(await names(inbox)).toEqual([]);
  });

  it("sweeps the files that abandoned jobs left behind, and nothing else", async () => {
    const old = new Date(Date.now() - 20 * 60 * SECOND);
    const files = {
      [path.join(inbox, "old.py")]: true,
      [path.join(inbox, ".old.part")]: true,
      [path.join(outbox, "old.json")]: true,
      [path.join(outbox, "old.mp4")]: true,
      [path.join(outbox, "new.mp4")]: false,
      [path.join(outbox, ".heartbeat")]: false,
      [path.join(outbox, "notes.txt")]: false,
    };
    for (const [file, aged] of Object.entries(files)) {
      await writeFile(file, "x");
      if (aged || file.endsWith(".heartbeat") || file.endsWith(".txt"))
        await utimes(file, old, old);
    }

    expect(await sandbox.sweep()).toBe(4);
    expect(await names(inbox)).toEqual([]);
    expect(await names(outbox)).toEqual([".heartbeat", "new.mp4", "notes.txt"]);
  });
});
