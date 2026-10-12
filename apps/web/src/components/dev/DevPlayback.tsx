"use client";

import { useMemo, type ReactNode } from "react";
import type { ExplanationDocument, Language } from "scene";
import { PlaybackProvider } from "@/components/player/PlaybackProvider";

export interface DevPlaybackProps {
  document: ExplanationDocument;
  language?: Language;
  sceneLimit?: number;
  complete?: boolean;
  children: ReactNode;
}

export function DevPlayback({
  document,
  language = "fr",
  sceneLimit,
  complete = true,
  children,
}: DevPlaybackProps) {
  const explanation = useMemo(
    () => ({
      scenes: document.scenes.slice(0, sceneLimit ?? document.scenes.length),
      params: document.params,
      model: document.model,
      language,
      complete,
    }),
    [document, language, sceneLimit, complete],
  );
  return (
    <PlaybackProvider explanation={explanation} autoPlay={false}>
      {children}
    </PlaybackProvider>
  );
}
