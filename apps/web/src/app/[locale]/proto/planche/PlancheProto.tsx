"use client";

import { useMemo } from "react";
import type { ExplanationDocument } from "scene";
import { Planche } from "@/components/player/Planche";
import {
  PlaybackProvider,
  usePlayback,
  usePlaybackPosition,
} from "@/components/player/PlaybackProvider";

function Status() {
  const playback = usePlayback();
  const { frame, location } = usePlaybackPosition();
  return (
    <output data-testid="status" className="text-data">
      {JSON.stringify({
        ready: playback.ready,
        playing: playback.playing,
        ended: playback.ended,
        frame,
        scene: location?.scene.index ?? null,
        duration: playback.durationInFrames,
      })}
    </output>
  );
}

function Buttons() {
  const playback = usePlayback();
  return (
    <p>
      <button type="button" data-testid="toggle" onClick={(event) => playback.toggle(event)}>
        toggle
      </button>
      <button type="button" data-testid="scene3" onClick={() => playback.seekToScene(2)}>
        scene 3
      </button>
    </p>
  );
}

export function PlancheProto({ document }: { document: ExplanationDocument }) {
  const explanation = useMemo(
    () => ({
      scenes: document.scenes,
      params: document.params,
      model: document.model,
      language: "fr" as const,
      complete: true,
    }),
    [document],
  );
  return (
    <main className="page-width py-6">
      <PlaybackProvider explanation={explanation} autoPlay={false}>
        <Planche />
        <Buttons />
        <Status />
      </PlaybackProvider>
    </main>
  );
}
