import { execFile, execFileSync } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureProvider, type GenerateRequest, type LlmProvider } from "@/server/llm";
import { renderDeepVersion } from "../src/deep/orchestrate";
import { DEEP_REPAIR_MARKER, DEEP_WRITE_MARKER } from "../src/deep/prompt";
import { createSandbox, type Sandbox } from "../src/deep/sandbox";
import { derivativeRecord, loadGravity, scratchDir, waitFor } from "./helpers/support";

const IMAGE = "eureka-manim:test";
const SAMPLE = fileURLToPath(new URL("../../manim/samples/derivative.py", import.meta.url));
const FIVE_MINUTES = 5 * 60_000;
const BROKEN = `from manim import *


class Broken(Scene):
    def construct(self):
        axes = Axes(x_range=[-1, 4, 1], y_range=[-1, 9, 2], axis_config={"color": CHALK})
        self.add(axes)
        raise ValueError("the tangent was never drawn")
`;
const execute = promisify(execFile);

function available(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const READY =
  available("docker", ["image", "inspect", IMAGE]) && available("ffprobe", ["-version"]);
if (!READY) console.warn(`docker, ffprobe or the image ${IMAGE} is missing: deep e2e test skipped`);

describe.skipIf(!READY)("deep version against the real sandbox", () => {
  const container = `eureka-deep-e2e-${process.pid}-${Date.now()}`;
  let root: string;
  let dir: string;
  let mediaDir: string;
  let sandbox: Sandbox;

  beforeAll(async () => {
    root = await scratchDir("deep-e2e");
    dir = path.join(root, "sandbox");
    mediaDir = path.join(root, "media");
    for (const folder of [dir, path.join(dir, "in"), path.join(dir, "out")]) {
      await mkdir(folder, { recursive: true });
      await chmod(folder, 0o777);
    }
    // The isolation of workers/manim/tests/run-tests.sh.
    await execute("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:size=256m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "1000:1000",
      "--cpus",
      "2",
      "--memory",
      "2g",
      "--memory-swap",
      "2g",
      "--pids-limit",
      "256",
      "--ipc",
      "none",
      "--volume",
      `${dir}:/data/sandbox`,
      IMAGE,
    ]);
    sandbox = createSandbox({ dir });
    await waitFor(() => sandbox.alive(), 60_000);
  }, 90_000);

  afterAll(async () => {
    await execute("docker", ["rm", "--force", container]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it(
    "repairs a render error and makes the video of the derivative in under five minutes",
    async () => {
      const record = derivativeRecord(await loadGravity());
      const sample = await readFile(SAMPLE, "utf8");
      const provider = createFixtureProvider([
        {
          name: "derivative",
          question: record.title!,
          steps: [
            { role: "author", when: DEEP_WRITE_MARKER, response: { code: BROKEN } },
            { role: "author", when: DEEP_REPAIR_MARKER, response: { code: sample } },
          ],
        },
      ]);
      const requests: GenerateRequest<unknown>[] = [];
      const llm: LlmProvider = {
        ...provider,
        generateObject: <T>(request: GenerateRequest<T>) => {
          requests.push(request as GenerateRequest<unknown>);
          return provider.generateObject(request);
        },
      };
      const progress: number[] = [];
      const lines: string[] = [];

      const began = Date.now();
      const outcome = await renderDeepVersion({
        record,
        llm,
        sandbox,
        mediaDir,
        onProgress: (percent) => progress.push(percent),
        log: (line) => lines.push(line),
      });
      const elapsed = Date.now() - began;
      console.info(`Deep version end to end: ${elapsed} ms. ${lines.join(" ")}`);

      const file = path.join(mediaDir, record.id, "deep.mp4");
      expect(outcome).toEqual({ status: "succeeded", file, attempts: 2 });
      expect(elapsed).toBeLessThan(FIVE_MINUTES);

      expect(requests).toHaveLength(2);
      const repair = requests[1]!.messages.map((message) => message.content).join("\n");
      expect(repair).toContain(DEEP_REPAIR_MARKER);
      expect(repair).toMatch(
        /<untrusted_sandbox_report stage="render">[^]*ValueError: the tangent was never drawn[^]*<\/untrusted_sandbox_report>/,
      );
      expect(progress.slice(0, 3)).toEqual([5, 20, 25]);
      expect(progress.at(-1)).toBe(95);

      const { stdout } = await execute("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,r_frame_rate:format=duration",
        "-of",
        "json",
        file,
      ]);
      const probe = JSON.parse(stdout) as {
        streams: { codec_name: string; width: number; height: number; r_frame_rate: string }[];
        format: { duration: string };
      };
      expect(probe.streams[0]).toEqual({
        codec_name: "h264",
        width: 1280,
        height: 720,
        r_frame_rate: "30/1",
      });
      expect(Number(probe.format.duration)).toBeGreaterThan(29);
      expect(Number(probe.format.duration)).toBeLessThan(31);

      expect(await readdir(path.join(dir, "in"))).toEqual([]);
      const outbox = await readdir(path.join(dir, "out"));
      expect(outbox.filter((name) => !name.includes(".heartbeat"))).toEqual([]);
      expect(await readdir(path.dirname(file))).toEqual(["deep.mp4"]);
    },
    FIVE_MINUTES + 60_000,
  );
});
