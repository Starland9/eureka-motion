"use client";

import type { ReactNode } from "react";
import type { ExplanationDocument } from "scene";
import { DevPlayback } from "@/components/dev/DevPlayback";
import { Planche } from "@/components/player/Planche";
import { usePlayback, usePlaybackPosition } from "@/components/player/PlaybackProvider";
import { Transport } from "@/components/player/Transport";

function Status({ id }: { id: string }) {
  const playback = usePlayback();
  const { frame, location } = usePlaybackPosition();
  return (
    <output data-testid={id} className="text-data block break-all text-ink-soft">
      {JSON.stringify({
        ready: playback.ready,
        playing: playback.playing,
        waiting: playback.waiting,
        ended: playback.ended,
        muted: playback.muted,
        captions: playback.captions,
        volume: playback.volume,
        frame,
        scene: location?.scene.index ?? null,
        duration: playback.durationInFrames,
      })}
    </output>
  );
}

function Instance({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-caption text-ink-soft">{title}</h2>
      {children}
    </section>
  );
}

export function TransportWorkbench({ document }: { document: ExplanationDocument }) {
  return (
    <main id="content" className="page-width flex flex-col gap-12 py-6">
      <Instance title="Complete explanation">
        <DevPlayback document={document}>
          <Planche />
          <Transport />
          <Status id="status" />
        </DevPlayback>
      </Instance>
      <Instance title="Partial explanation, 2 scenes of 6">
        <DevPlayback document={document} sceneLimit={2} complete={false}>
          <Planche />
          <Transport plannedSceneCount={6} shortcuts={false} />
          <Status id="status-partial" />
        </DevPlayback>
      </Instance>
      <Instance title="No scene yet">
        <DevPlayback document={document} sceneLimit={0} complete={false}>
          <Transport plannedSceneCount={6} shortcuts={false} />
          <Status id="status-empty" />
        </DevPlayback>
      </Instance>
    </main>
  );
}
