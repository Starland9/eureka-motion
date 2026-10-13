import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MEDIA_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

// Letters, digits, dot, dash and underscore; never a leading dot.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function getMediaDir(env: Readonly<Record<string, string | undefined>> = process.env) {
  return path.resolve(/* turbopackIgnore: true */ env.MEDIA_DIR || "./media");
}

export function isSafeSegment(segment: string): boolean {
  return SAFE_SEGMENT.test(segment);
}

export function resolveMediaPath(
  segments: readonly string[],
  mediaDir: string = getMediaDir(),
): string | null {
  if (segments.length === 0 || !segments.every(isSafeSegment)) return null;
  const extension = path.extname(segments[segments.length - 1]!).toLowerCase();
  if (!Object.hasOwn(MEDIA_CONTENT_TYPES, extension)) return null;
  const root = path.resolve(/* turbopackIgnore: true */ mediaDir);
  const resolved = path.resolve(/* turbopackIgnore: true */ root, ...segments);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

export async function writeFileAtomic(file: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}
