import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_CONTENT_TYPES, resolveMediaPath } from "@/server/media";

interface Context {
  params: Promise<{ path: string[] }>;
}

interface ByteRange {
  start: number;
  end: number;
}

const CACHE_CONTROL = "public, max-age=31536000, immutable";

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

// null: no usable single range, serve the whole file (RFC 9110 § 14.2).
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
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

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const file = resolveMediaPath((await params).path);
  if (!file) return notFound();
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return notFound();

  const headers: Record<string, string> = {
    "Content-Type": MEDIA_CONTENT_TYPES[path.extname(file).toLowerCase()]!,
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(request.headers.get("range"), info.size);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${info.size}` },
    });
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  const body =
    info.size === 0
      ? null
      : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>);
  headers["Content-Length"] = String(info.size === 0 ? 0 : end - start + 1);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}
