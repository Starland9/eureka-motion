import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mp3DurationMs } from "@/server/tts";
import { runVoicesCompare } from "../../../../scripts/voices-compare";

const FIXTURE = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));
const PHRASES = JSON.parse(
  await readFile(
    path.join(__dirname, "..", "..", "..", "..", "scripts", "voice-phrases.json"),
    "utf8",
  ),
) as { fr: string[]; en: string[] };

interface Fake {
  server: Server;
  url: string;
  bodies: { input: string; voice: string }[];
}

const servers: Server[] = [];
let out: string;

beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), "voices-compare-"));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await rm(out, { recursive: true, force: true });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function fakeService(): Promise<Fake> {
  const bodies: Fake["bodies"] = [];
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200).end("ok");
      return;
    }
    if (request.method === "POST" && request.url === "/v1/audio/speech") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, { "Content-Type": "audio/mpeg" }).end(FIXTURE);
      });
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  return { server, url: await listen(server), bodies };
}

async function closedUrl(): Promise<string> {
  const server = createServer();
  const url = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return url;
}

async function compare(argv: string[], env: Record<string, string>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runVoicesCompare({
    argv: ["--out", out, ...argv],
    env,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

async function readIndex() {
  return JSON.parse(await readFile(path.join(out, "index.json"), "utf8")) as {
    records: {
      provider: string;
      language: string;
      index: number;
      text: string;
      voice: string;
      durationMs: number;
      elapsedMs: number;
      file: string;
    }[];
    failures: { provider: string; stage: string; language?: string; message: string }[];
  };
}

function names(files: string[]): string[] {
  return files.filter((name) => name !== "index.json").sort();
}

describe("voices:compare", () => {
  it("writes one MP3 per provider and phrase and an index with every record", async () => {
    const kokoro = await fakeService();
    const pocket = await fakeService();
    const env = { KOKORO_BASE_URL: kokoro.url, POCKET_BASE_URL: pocket.url };

    const result = await compare(["--providers", "kokoro,pocket"], env);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(names(await readdir(out))).toEqual(["kokoro", "pocket"]);

    const expected = (["fr", "en"] as const).flatMap((language) =>
      PHRASES[language].map((text, position) => ({
        language,
        text,
        index: position + 1,
        file: `${language}-${String(position + 1).padStart(2, "0")}.mp3`,
      })),
    );
    for (const provider of ["kokoro", "pocket"]) {
      expect(await readdir(path.join(out, provider))).toHaveLength(expected.length);
      for (const { file } of expected) {
        expect(Buffer.compare(await readFile(path.join(out, provider, file)), FIXTURE)).toBe(0);
      }
    }

    const { records, failures } = await readIndex();
    expect(failures).toEqual([]);
    expect(records).toHaveLength(2 * expected.length);
    const fixtureDuration = mp3DurationMs(new Uint8Array(FIXTURE));
    const voices = {
      kokoro: { fr: "ff_siwis", en: "af_heart" },
      pocket: { fr: "estelle", en: "alba" },
    };
    for (const provider of ["kokoro", "pocket"] as const) {
      for (const item of expected) {
        const record = records.find(
          (candidate) =>
            candidate.provider === provider &&
            candidate.language === item.language &&
            candidate.index === item.index,
        );
        expect(record).toMatchObject({
          text: item.text,
          voice: voices[provider][item.language],
          durationMs: fixtureDuration,
          file: `${provider}/${item.file}`,
        });
        expect(record?.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    }
    expect(kokoro.bodies.map((body) => body.input)).toEqual([...PHRASES.fr, ...PHRASES.en]);
    expect(pocket.bodies.map((body) => body.voice)).toEqual([
      ...PHRASES.fr.map(() => "estelle"),
      ...PHRASES.en.map(() => "alba"),
    ]);
    expect(result.stdout).toContain(`kokoro fr 01 elapsed `);
    expect(result.stdout).toContain(`pocket en 16 elapsed `);
  });

  it("reports a provider that does not answer and still produces the other one", async () => {
    const kokoro = await fakeService();
    const env = { KOKORO_BASE_URL: kokoro.url, POCKET_BASE_URL: await closedUrl() };

    const result = await compare(["--providers", "pocket,kokoro", "--lang", "fr"], env);

    expect(result.code).toBe(1);
    expect(await readdir(path.join(out, "kokoro"))).toHaveLength(PHRASES.fr.length);
    expect(await readdir(path.join(out, "pocket"))).toEqual([]);
    expect(result.stderr).toContain("pocket: the service does not answer its health check");
    expect(result.stderr).toContain("pocket fr 01 FAILED");
    expect(result.stderr).toMatch(/Failures \(\d+\):/);
    expect(result.stderr).not.toContain("kokoro");

    const { records, failures } = await readIndex();
    expect(records.every((record) => record.provider === "kokoro")).toBe(true);
    expect(records).toHaveLength(PHRASES.fr.length);
    expect(failures.map((failure) => failure.stage)).toEqual([
      "health",
      ...PHRASES.fr.map(() => "phrase"),
    ]);
    expect(failures.every((failure) => failure.provider === "pocket")).toBe(true);
  });

  it("produces only French with --lang fr", async () => {
    const kokoro = await fakeService();

    const result = await compare(["--providers", "kokoro", "--lang", "fr"], {
      KOKORO_BASE_URL: kokoro.url,
    });

    expect(result.code).toBe(0);
    const files = await readdir(path.join(out, "kokoro"));
    expect(files).toHaveLength(PHRASES.fr.length);
    expect(files.every((file) => file.startsWith("fr-"))).toBe(true);
    const { records } = await readIndex();
    expect(records.every((record) => record.language === "fr")).toBe(true);
    expect(kokoro.bodies.map((body) => body.input)).toEqual(PHRASES.fr);
  });

  it("takes the providers from TTS_PROVIDERS and ignores none", async () => {
    const pocket = await fakeService();

    const result = await compare(["--lang", "en"], {
      TTS_PROVIDERS: "pocket,none",
      POCKET_BASE_URL: pocket.url,
    });

    expect(result.code).toBe(0);
    expect(names(await readdir(out))).toEqual(["pocket"]);
  });

  it("refuses an unknown provider or language before any call", async () => {
    const unknown = await compare(["--providers", "espeak"], {});
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown voice provider "espeak"');
    expect(await readdir(out)).toEqual([]);

    const language = await compare(["--lang", "de"], {});
    expect(language.code).toBe(2);
    expect(language.stderr).toContain("--lang must be one of fr, en");
  });
});
