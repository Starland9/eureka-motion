"use client";

import { useState, type ReactNode } from "react";
import type { ExplanationDocument } from "scene";
import { DevPlayback } from "@/components/dev/DevPlayback";
import { FigureCaption } from "@/components/player/FigureCaption";
import { Planche } from "@/components/player/Planche";
import { usePlayback, usePlaybackPosition } from "@/components/player/PlaybackProvider";
import { SceneList } from "@/components/player/SceneList";
import { Subtitles } from "@/components/player/Subtitles";

const BUTTON = "touch-target border border-ink px-3 text-control";

function Probe({ name }: { name: string }) {
  const playback = usePlayback();
  const { frame } = usePlaybackPosition();
  const scene = playback.timeline.scenes.find(
    (s) => frame >= s.start && frame < s.start + s.duration,
  );
  const inScene = scene ? frame - scene.start : 0;
  const beat = scene?.beats.find((b) => inScene >= b.start && inScene < b.start + b.duration);
  const source = scene ? playback.explanation.scenes[scene.index] : undefined;
  return (
    <output
      data-testid={`probe-${name}`}
      data-frame={frame}
      data-duration={playback.durationInFrames}
      data-ready={playback.ready}
      data-playing={playback.playing}
      data-captions={playback.captions}
      data-scene-starts={playback.timeline.scenes.map((s) => s.start).join(",")}
      data-beat-starts={playback.timeline.scenes
        .flatMap((s) => s.beats.map((b) => s.start + b.start))
        .join(",")}
      data-expected-narration={beat?.narration ?? ""}
      data-expected-number={source ? source.index + 1 : ""}
      data-expected-title={source?.title ?? ""}
      className="text-data"
    >
      {`frame ${frame} / ${playback.durationInFrames}`}
    </output>
  );
}

function Controls({ name }: { name: string }) {
  const playback = usePlayback();
  const [target, setTarget] = useState("0");
  return (
    <p className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={`toggle-${name}`}
        className={BUTTON}
        onClick={(event) => playback.toggle(event)}
      >
        {playback.playing ? "pause" : "play"}
      </button>
      <input
        type="number"
        aria-label="frame"
        data-testid={`frame-${name}`}
        value={target}
        min={0}
        className="touch-target w-24 border border-ink bg-surface-raised px-2 text-data"
        onChange={(event) => setTarget(event.target.value)}
      />
      <button
        type="button"
        data-testid={`seek-${name}`}
        className={BUTTON}
        onClick={() => playback.seekToFrame(Number(target))}
      >
        seek
      </button>
      <button
        type="button"
        data-testid={`captions-${name}`}
        aria-pressed={playback.captions}
        className={BUTTON}
        onClick={() => playback.setCaptions(!playback.captions)}
      >
        captions
      </button>
      <Probe name={name} />
    </p>
  );
}

function Instance({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <section data-testid={`instance-${name}`} aria-label={title} className="flex flex-col gap-4">
      <h2 className="text-title">{title}</h2>
      {children}
    </section>
  );
}

function Layout({
  name,
  plannedCount,
  dropped,
}: {
  name: string;
  plannedCount?: number;
  dropped?: number[];
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
        <Planche />
        <FigureCaption className="mx-3 sm:mx-4" />
        <Subtitles />
        <p data-testid={`below-${name}`} className="text-data text-ink-faint">
          below the subtitles
        </p>
        <Controls name={name} />
      </div>
      <SceneList className="lg:col-span-4" plannedCount={plannedCount} dropped={dropped} />
    </div>
  );
}

const DROPPED = [3];

export function ScenesWorkbench({ document }: { document: ExplanationDocument }) {
  return (
    <main id="content" className="page-width flex flex-col gap-16 py-6">
      <Instance name="full" title="Complete explanation">
        <DevPlayback document={document}>
          <Layout name="full" />
        </DevPlayback>
      </Instance>
      <Instance name="partial" title="Partial explanation (2 of 6, scene 4 dropped)">
        <DevPlayback document={document} sceneLimit={2} complete={false}>
          <Layout name="partial" plannedCount={6} dropped={DROPPED} />
        </DevPlayback>
      </Instance>
    </main>
  );
}
