import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const HEARTBEAT_MAX_AGE_MS = 60_000;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const ORPHAN_AGE_MS = 15 * 60 * 1000;
export const POLL_MS = 500;

const MAX_RESULT_BYTES = 256 * 1024;
const MAX_HEARTBEAT_BYTES = 64;
const UNREADABLE_POLLS = 3;
const READ_ONLY = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const INBOX_FILE = /^(?:[A-Za-z0-9_-]{1,64}\.py|\.[A-Za-z0-9_-]{1,64}\.part)$/;
const OUTBOX_FILE = /^[A-Za-z0-9_-]{1,64}\.(?:json|mp4)$/;

export type SandboxErrorCode =
  "sandbox_unavailable" | "timeout" | "cancelled" | "invalid_result" | "invalid_video";

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;

  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

export type SandboxStage = "static_check" | "render";

export interface SandboxResult {
  ok: boolean;
  stage: SandboxStage;
  duration_ms: number;
  error: string;
  stderr_tail: string;
}

export interface AwaitOptions {
  deadline: number;
  signal?: AbortSignal;
  pollMs?: number;
  onPoll?: () => void;
}

export interface Sandbox {
  alive(): Promise<boolean>;
  submit(code: string): Promise<{ id: string }>;
  awaitResult(id: string, options: AwaitOptions): Promise<SandboxResult>;
  collect(id: string, destination: string): Promise<void>;
  cleanup(id: string): Promise<void>;
  sweep(olderThanMs?: number): Promise<number>;
}

export interface SandboxOptions {
  dir: string;
  now?: () => number;
  newId?: () => string;
  maxVideoBytes?: number;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function checkedId(id: string): string {
  if (!JOB_ID.test(id)) throw new Error("Invalid sandbox job id");
  return id;
}

function parseResult(value: unknown): SandboxResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { ok, stage, duration_ms, error, stderr_tail } = value as Record<string, unknown>;
  if (typeof ok !== "boolean" || (stage !== "static_check" && stage !== "render")) return null;
  return {
    ok,
    stage,
    duration_ms: typeof duration_ms === "number" && Number.isFinite(duration_ms) ? duration_ms : 0,
    error: typeof error === "string" ? error : "",
    stderr_tail: typeof stderr_tail === "string" ? stderr_tail : "",
  };
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

export function createSandbox(options: SandboxOptions): Sandbox {
  const inbox = path.join(options.dir, "in");
  const outbox = path.join(options.dir, "out");
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => `deep-${randomUUID()}`);
  const maxVideoBytes = options.maxVideoBytes ?? MAX_VIDEO_BYTES;

  async function readSmall(file: string, limit: number): Promise<string> {
    const handle = await open(file, READ_ONLY);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit) throw new Error("not a small regular file");
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  async function alive(): Promise<boolean> {
    try {
      const text = (await readSmall(path.join(outbox, ".heartbeat"), MAX_HEARTBEAT_BYTES)).trim();
      if (!/^\d{1,13}$/.test(text)) return false;
      const value = Number(text);
      const beatMs = value > 1e11 ? value : value * 1000;
      return now() - beatMs <= HEARTBEAT_MAX_AGE_MS;
    } catch {
      return false;
    }
  }

  async function readResult(id: string): Promise<SandboxResult | "missing" | "unreadable"> {
    let text: string;
    try {
      text = await readSmall(path.join(outbox, `${id}.json`), MAX_RESULT_BYTES);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "missing";
      throw new SandboxError("invalid_result", "The result is not a regular file of a sane size.");
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return "unreadable";
    }
    const result = parseResult(value);
    if (!result) {
      throw new SandboxError("invalid_result", "The result does not have the expected shape.");
    }
    return result;
  }

  async function remove(file: string): Promise<void> {
    await unlink(file).catch(() => undefined);
  }

  async function cleanup(id: string): Promise<void> {
    checkedId(id);
    await Promise.all([
      remove(path.join(inbox, `.${id}.part`)),
      remove(path.join(inbox, `${id}.py`)),
      remove(path.join(outbox, `${id}.json`)),
      remove(path.join(outbox, `${id}.mp4`)),
    ]);
  }

  return {
    alive,

    async submit(code) {
      if (!(await alive())) {
        throw new SandboxError("sandbox_unavailable", "The sandbox has given no sign of life.");
      }
      const id = checkedId(newId());
      const partial = path.join(inbox, `.${id}.part`);
      try {
        await writeFile(partial, code, { flag: "wx", mode: 0o644 });
        await rename(partial, path.join(inbox, `${id}.py`));
      } catch {
        await remove(partial);
        throw new SandboxError("sandbox_unavailable", "The code could not be deposited.");
      }
      return { id };
    },

    async awaitResult(id, { deadline, signal, pollMs = POLL_MS, onPoll }) {
      checkedId(id);
      let unreadable = 0;
      for (;;) {
        if (signal?.aborted) throw new SandboxError("cancelled", "The wait was cancelled.");
        const result = await readResult(id);
        if (typeof result === "object") return result;
        if (result === "unreadable") {
          unreadable += 1;
          if (unreadable >= UNREADABLE_POLLS) {
            throw new SandboxError("invalid_result", "The result is not valid JSON.");
          }
        }
        if (!(await alive())) {
          throw new SandboxError("sandbox_unavailable", "The sandbox stopped beating.");
        }
        const remaining = deadline - now();
        if (remaining <= 0) throw new SandboxError("timeout", "No result before the deadline.");
        onPoll?.();
        await wait(Math.min(pollMs, remaining), signal);
      }
    },

    async collect(id, destination) {
      checkedId(id);
      let handle;
      try {
        handle = await open(path.join(outbox, `${id}.mp4`), READ_ONLY);
      } catch (error) {
        throw new SandboxError(
          "invalid_video",
          errorCode(error) === "ELOOP" ? "The video is a symbolic link." : "The video is missing.",
        );
      }
      try {
        const info = await handle.stat();
        if (!info.isFile())
          throw new SandboxError("invalid_video", "The video is not a regular file.");
        if (info.size === 0 || info.size > maxVideoBytes) {
          throw new SandboxError("invalid_video", `The video has ${info.size} bytes.`);
        }
        const header = Buffer.alloc(8);
        await handle.read(header, 0, 8, 0);
        if (header.subarray(4, 8).toString("latin1") !== "ftyp") {
          throw new SandboxError("invalid_video", "The video is not an MP4 file.");
        }
        const folder = path.dirname(destination);
        await mkdir(folder, { recursive: true });
        // The sandbox and the media are two volumes: a rename between them would fail.
        const partial = path.join(
          folder,
          `.${path.basename(destination)}.${randomUUID()}.part.mp4`,
        );
        try {
          await pipeline(
            handle.createReadStream({ start: 0, end: info.size - 1, autoClose: false }),
            createWriteStream(partial, { flags: "wx", mode: 0o644 }),
          );
          if ((await lstat(partial)).size !== info.size) {
            throw new SandboxError("invalid_video", "The video changed while it was copied.");
          }
          await rename(partial, destination);
        } catch (error) {
          await rm(partial, { force: true });
          throw error;
        }
      } finally {
        await handle.close();
      }
      await cleanup(id);
    },

    cleanup,

    async sweep(olderThanMs = ORPHAN_AGE_MS) {
      const cutoff = now() - olderThanMs;
      let removed = 0;
      for (const [folder, pattern] of [
        [inbox, INBOX_FILE],
        [outbox, OUTBOX_FILE],
      ] as const) {
        const names = await readdir(folder).catch(() => [] as string[]);
        for (const name of names) {
          if (!pattern.test(name)) continue;
          const file = path.join(folder, name);
          const info = await lstat(file).catch(() => null);
          if (!info || info.isDirectory() || info.mtimeMs > cutoff) continue;
          await remove(file);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
