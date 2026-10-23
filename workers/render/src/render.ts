import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import type { ExplanationDocument, Language } from "scene";
import { EXPORT_COMPOSITION_ID, type ExportInputProps } from "scene/export";
import { startStaticServer } from "./static-server";

export interface RenderRequest {
  document: ExplanationDocument;
  language: Language;
  outFile: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export type ExportRenderer = (request: RenderRequest) => Promise<void>;

export interface RendererOptions {
  serveUrl: string;
  mediaDir: string;
  referenceDir: string;
  browserExecutable?: string;
}

const require = createRequire(import.meta.url);

export async function bundleComposition(): Promise<string> {
  return bundle({ entryPoint: require.resolve("scene/remotion"), enableCaching: false });
}

type RenderTarget = Pick<RendererOptions, "serveUrl" | "browserExecutable"> & {
  assetBaseUrl: string;
};

export async function renderExport(request: RenderRequest & RenderTarget): Promise<void> {
  const { document, language, outFile, onProgress, signal, serveUrl, assetBaseUrl } = request;
  if (signal?.aborted) throw new Error("The render was cancelled.");
  const inputProps: ExportInputProps = {
    document: { scenes: document.scenes, params: document.params, model: document.model },
    language,
    assetBaseUrl,
  };
  const browserExecutable = request.browserExecutable ?? null;
  const { cancelSignal, cancel } = makeCancelSignal();
  signal?.addEventListener("abort", cancel, { once: true });
  // Remotion picks the container from the extension, so the temporary name still ends in .mp4.
  const partial = path.join(
    path.dirname(outFile),
    `.${path.basename(outFile)}.${randomUUID()}.part.mp4`,
  );
  try {
    const composition = await selectComposition({
      serveUrl,
      id: EXPORT_COMPOSITION_ID,
      inputProps,
      browserExecutable,
    });
    await mkdir(path.dirname(outFile), { recursive: true });
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      enforceAudioTrack: true,
      outputLocation: partial,
      overwrite: true,
      browserExecutable,
      cancelSignal,
      onProgress: ({ progress }) => onProgress?.(progress * 100),
    });
    await rename(partial, outFile);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export function createRenderer(options: RendererOptions): ExportRenderer {
  const { serveUrl, mediaDir, referenceDir, browserExecutable } = options;
  const roots = [mediaDir, path.join(referenceDir, "audio")];
  return async (request) => {
    const server = await startStaticServer(roots);
    try {
      await renderExport({ ...request, serveUrl, assetBaseUrl: server.url, browserExecutable });
    } finally {
      await server.close();
    }
  };
}
