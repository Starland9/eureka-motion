import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { resolveMediaPath } from "../../../apps/web/src/server/media";

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

interface ByteRange {
  start: number;
  end: number;
}

const PREFIX = "/media/";
const HOST = "127.0.0.1";
const EXPOSED_HEADERS = "Accept-Ranges, Content-Length, Content-Range, Content-Type";

// null: serve the whole file (RFC 9110 § 14.2).
function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    return suffix === 0 || size === 0
      ? "unsatisfiable"
      : { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] !== "" && Number(match[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1) };
}

async function locate(roots: readonly string[], pathname: string) {
  if (!pathname.startsWith(PREFIX)) return null;
  let segments: string[];
  try {
    segments = pathname.slice(PREFIX.length).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  for (const root of roots) {
    const file = resolveMediaPath(segments, root);
    if (!file || path.extname(file).toLowerCase() !== ".mp3") continue;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return { file, size: info.size };
  }
  return null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": EXPOSED_HEADERS,
  "Cache-Control": "no-store",
};

function reply(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, { ...CORS, ...headers });
  response.end();
}

async function handle(
  roots: readonly string[],
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "OPTIONS") {
    return reply(response, 204, {
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply(response, 405, { Allow: "GET, HEAD, OPTIONS" });
  }
  const found = await locate(roots, new URL(request.url ?? "/", `http://${HOST}`).pathname);
  if (!found) return reply(response, 404);

  const range = parseRange(request.headers.range, found.size);
  if (range === "unsatisfiable") {
    return reply(response, 416, { "Content-Range": `bytes */${found.size}` });
  }
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/mpeg",
    "Content-Length": String(range ? range.end - range.start + 1 : found.size),
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${found.size}`;
  if (request.method === "HEAD") return reply(response, range ? 206 : 200, headers);

  response.writeHead(range ? 206 : 200, { ...CORS, ...headers });
  const stream = createReadStream(found.file, range ?? undefined);
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

export async function startStaticServer(roots: readonly string[]): Promise<StaticServer> {
  const server = createServer((request, response) => {
    handle(roots, request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else reply(response, 500);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
