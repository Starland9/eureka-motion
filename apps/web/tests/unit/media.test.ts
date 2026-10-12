import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/media/[...path]/route";
import { getMediaDir, resolveMediaPath } from "@/server/media";

const BYTES = new Uint8Array(256).map((_, index) => index);
const SECRET = "DATABASE_URL=postgresql://secret";

let sandbox: string;
let mediaDir: string;

beforeAll(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "media-route-"));
  mediaDir = path.join(sandbox, "media");
  await mkdir(path.join(mediaDir, "abc"), { recursive: true });
  await mkdir(path.join(mediaDir, ".tts-cache"), { recursive: true });
  await writeFile(path.join(mediaDir, "abc", "s1-b1.mp3"), BYTES);
  await writeFile(path.join(mediaDir, "abc", "export.mp4"), BYTES);
  await writeFile(path.join(mediaDir, "abc", "empty.mp3"), "");
  await writeFile(path.join(mediaDir, "abc", "notes.txt"), "text");
  await writeFile(path.join(mediaDir, ".hidden.mp3"), BYTES);
  await writeFile(path.join(mediaDir, ".tts-cache", "x.mp3"), BYTES);
  await writeFile(path.join(sandbox, ".env"), SECRET);
  await writeFile(path.join(sandbox, "outside.mp3"), BYTES);
  vi.stubEnv("MEDIA_DIR", mediaDir);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(sandbox, { recursive: true, force: true });
});

function get(segments: string[], range?: string): Promise<Response> {
  const headers: Record<string, string> = range ? { range } : {};
  const url = `http://localhost/media/${segments.join("/")}`;
  return GET(new Request(url, { headers }), { params: Promise.resolve({ path: segments }) });
}

async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe("resolveMediaPath", () => {
  it("returns an absolute path inside the media directory", () => {
    const resolved = resolveMediaPath(["abc", "s1-b1.mp3"], mediaDir);
    expect(resolved).toBe(path.join(mediaDir, "abc", "s1-b1.mp3"));
    expect(resolveMediaPath(["abc", "export.mp4"], mediaDir)).toBe(
      path.join(mediaDir, "abc", "export.mp4"),
    );
    expect(resolveMediaPath(["abc", "DEEP.MP4"], mediaDir)).not.toBeNull();
  });

  it("reads MEDIA_DIR from the environment by default", () => {
    expect(getMediaDir()).toBe(mediaDir);
    expect(resolveMediaPath(["abc", "s1-b1.mp3"])).toBe(path.join(mediaDir, "abc", "s1-b1.mp3"));
    expect(getMediaDir({})).toBe(path.resolve("./media"));
  });

  it.each([
    ["parent directory", ["..", ".env"]],
    ["parent directory then file", ["abc", "..", "..", "outside.mp3"]],
    ["encoded parent directory", ["%2e%2e", ".env"]],
    ["encoded separator", ["abc", "..%2f..%2foutside.mp3"]],
    ["encoded slash in a name", ["abc%2f..%2f..%2foutside.mp3"]],
    ["absolute path", ["/etc/passwd"]],
    ["absolute mp3", ["/var/lib/media/outside.mp3"]],
    ["separator inside a segment", ["abc/../../outside.mp3"]],
    ["backslash", ["abc\\..\\..\\outside.mp3"]],
    ["null byte", ["abc", "s1-b1.mp3\0.txt"]],
    ["hidden folder", [".tts-cache", "x.mp3"]],
    ["hidden file", [".hidden.mp3"]],
    ["hidden file in a folder", ["abc", ".s1.mp3"]],
    ["current directory", [".", "abc", "s1-b1.mp3"]],
    ["empty segment", ["abc", "", "s1-b1.mp3"]],
    ["wrong extension", ["abc", "notes.txt"]],
    ["no extension", ["abc", "s1-b1"]],
    ["extension in the middle", ["abc", "s1-b1.mp3.txt"]],
    ["environment file", [".env"]],
    ["nothing", []],
  ])("rejects %s", (_label, segments) => {
    expect(resolveMediaPath(segments, mediaDir)).toBeNull();
  });
});

describe("GET /media/[...path]", () => {
  it("serves a whole file with its type, range support and a long cache", async () => {
    const response = await get(["abc", "s1-b1.mp3"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("content-length")).toBe("256");
    expect(await bytesOf(response)).toEqual(BYTES);
  });

  it("serves video with the right type", async () => {
    const response = await get(["abc", "export.mp4"]);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.status).toBe(200);
  });

  it("serves an empty file", async () => {
    const response = await get(["abc", "empty.mp3"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect((await bytesOf(response)).length).toBe(0);
  });

  it.each([
    ["bytes=10-19", "bytes 10-19/256", 10, 20],
    ["bytes=0-0", "bytes 0-0/256", 0, 1],
    ["bytes=200-", "bytes 200-255/256", 200, 256],
    ["bytes=-16", "bytes 240-255/256", 240, 256],
    ["bytes=-1000", "bytes 0-255/256", 0, 256],
    ["bytes=250-9999", "bytes 250-255/256", 250, 256],
    ["bytes=255-255", "bytes 255-255/256", 255, 256],
  ])("answers %s with 206 and the right bytes", async (range, contentRange, from, to) => {
    const response = await get(["abc", "s1-b1.mp3"], range);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(to - from));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(await bytesOf(response)).toEqual(BYTES.slice(from, to));
  });

  it.each(["bytes=256-", "bytes=300-400", "bytes=-0"])(
    "answers %s with 416 and the size",
    async (range) => {
      const response = await get(["abc", "s1-b1.mp3"], range);
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */256");
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("cache-control")).toBeNull();
      expect((await bytesOf(response)).length).toBe(0);
    },
  );

  it("answers 416 to any range on an empty file", async () => {
    const response = await get(["abc", "empty.mp3"], "bytes=0-");
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
  });

  it.each(["bytes=0-9,20-29", "bytes=abc", "items=0-5", "bytes=-", "0-5", "bytes=20-10"])(
    "ignores the unusable header %s and serves the whole file",
    async (range) => {
      const response = await get(["abc", "s1-b1.mp3"], range);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-range")).toBeNull();
      expect(await bytesOf(response)).toEqual(BYTES);
    },
  );

  it("streams a large file range without needing it whole", async () => {
    const large = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    await writeFile(path.join(mediaDir, "abc", "large.mp3"), large);
    const response = await get(["abc", "large.mp3"], "bytes=2097152-2097407");
    expect(response.status).toBe(206);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(await bytesOf(response)).toEqual(large.slice(2_097_152, 2_097_408));
  });

  it.each([
    ["parent directory", ["..", ".env"]],
    ["parent directory out of a folder", ["abc", "..", "..", "outside.mp3"]],
    ["encoded parent directory", ["%2e%2e", ".env"]],
    ["double encoded parent directory", ["%252e%252e", "outside.mp3"]],
    ["absolute path", ["/etc/passwd"]],
    ["hidden cache folder", [".tts-cache", "x.mp3"]],
    ["hidden file", [".hidden.mp3"]],
    ["wrong extension", ["abc", "notes.txt"]],
    ["missing file", ["abc", "missing.mp3"]],
    ["missing folder", ["nope", "s1-b1.mp3"]],
    ["a folder", ["abc"]],
    ["nothing", []],
  ])("answers 404 for %s", async (_label, segments) => {
    const response = await get(segments);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("DATABASE_URL");
  });

  it("never serves the cache folder or anything outside the media directory", async () => {
    for (const segments of [
      ["..", "outside.mp3"],
      [".tts-cache", "x.mp3"],
    ]) {
      expect((await get(segments, "bytes=0-10")).status).toBe(404);
    }
  });
});
