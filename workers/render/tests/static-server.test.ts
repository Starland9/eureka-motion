import { request } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStaticServer, type StaticServer } from "../src/static-server";
import { scratchDir } from "./helpers/support";

const ID = "aaaaaaaaaaab";
const BYTES = Buffer.from("0123456789abcdefghij");

function rawGet(url: string, target: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    request({ hostname, port, path: target, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    })
      .on("error", reject)
      .end();
  });
}

describe("static server", () => {
  let root: string;
  let server: StaticServer;
  let mediaDir: string;
  let referenceDir: string;

  beforeAll(async () => {
    root = await scratchDir("static");
    mediaDir = path.join(root, "media");
    referenceDir = path.join(root, "reference");
    await mkdir(path.join(mediaDir, ID), { recursive: true });
    await mkdir(path.join(referenceDir, "audio", "bbbbbbbbbbbc"), { recursive: true });
    await writeFile(path.join(mediaDir, ID, "s1-b1.mp3"), BYTES);
    await writeFile(path.join(mediaDir, ID, "export.mp4"), "video");
    await writeFile(path.join(root, "secret.mp3"), "secret");
    await writeFile(path.join(referenceDir, "audio", "bbbbbbbbbbbc", "s1-b1.mp3"), "reference");
    server = await startStaticServer([mediaDir, path.join(referenceDir, "audio")]);
  });

  afterAll(async () => {
    await server.close();
    await rm(root, { recursive: true });
  });

  it("listens on the loopback interface only", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("serves a narration file whole, readable from another origin", async () => {
    const response = await fetch(`${server.url}/media/${ID}/s1-b1.mp3`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("answers byte ranges", async () => {
    const url = `${server.url}/media/${ID}/s1-b1.mp3`;

    const head = await fetch(url, { headers: { Range: "bytes=2-5" } });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 2-5/20");
    expect(await head.text()).toBe("2345");

    const open = await fetch(url, { headers: { Range: "bytes=15-" } });
    expect(open.status).toBe(206);
    expect(await open.text()).toBe("fghij");

    const suffix = await fetch(url, { headers: { Range: "bytes=-3" } });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("hij");

    const beyond = await fetch(url, { headers: { Range: "bytes=40-" } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe("bytes */20");
  });

  it("answers HEAD with the length and no body", async () => {
    const response = await fetch(`${server.url}/media/${ID}/s1-b1.mp3`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("20");
    expect(await response.text()).toBe("");
  });

  it("answers the preflight of a request with a range", async () => {
    const response = await fetch(`${server.url}/media/${ID}/s1-b1.mp3`, { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toBe("Range");
  });

  it("falls back to the audio of the reference explanations", async () => {
    const response = await fetch(`${server.url}/media/bbbbbbbbbbbc/s1-b1.mp3`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("reference");
  });

  it("serves nothing but narration files under /media/", async () => {
    for (const target of [
      `/media/${ID}/export.mp4`,
      `/media/${ID}/missing.mp3`,
      "/media/",
      "/",
      "/other/s1-b1.mp3",
      `/media/${ID}/%2e%2e/secret.mp3`,
      `/media/${ID}/..%2fsecret.mp3`,
      `/media/%00/s1-b1.mp3`,
      `/media/${ID}/%E0%A4%A.mp3`,
    ]) {
      expect(await rawGet(server.url, target), target).toMatchObject({ status: 404 });
    }
    expect(await rawGet(server.url, `/media/../secret.mp3`)).toMatchObject({ status: 404 });
  });

  it("refuses to change anything", async () => {
    const response = await fetch(`${server.url}/media/${ID}/s1-b1.mp3`, {
      method: "PUT",
      body: "x",
    });

    expect(response.status).toBe(405);
  });

  it("frees its port on close", async () => {
    const other = await startStaticServer([mediaDir]);
    await other.close();

    await expect(fetch(`${other.url}/media/${ID}/s1-b1.mp3`)).rejects.toThrow();
  });
});
