"use client";

import { useState, type ReactNode } from "react";
import type { ExplanationDocument, ThemeName } from "scene";
import { DevPlayback } from "@/components/dev/DevPlayback";
import { Planche } from "@/components/player/Planche";
import { usePlayback, usePlaybackPosition } from "@/components/player/PlaybackProvider";
import { Subtitles } from "@/components/player/Subtitles";
import { Transport } from "@/components/player/Transport";
import { Button } from "@/components/ui/button";
import { setTheme, useTheme } from "@/lib/theme-client";

const THEMES: readonly { name: ThemeName; label: string }[] = [
  { name: "paper", label: "Papier" },
  { name: "board", label: "Tableau" },
];

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
        beat: location?.beat.index ?? null,
        reducedMotion: playback.reducedMotion,
        theme: playback.theme,
        duration: playback.durationInFrames,
      })}
    </output>
  );
}

function TimelineData() {
  const { timeline } = usePlayback();
  return (
    <output data-testid="timeline" hidden>
      {JSON.stringify(
        timeline.scenes.map((scene) => ({
          id: scene.id,
          start: scene.start,
          duration: scene.duration,
          beats: scene.beats.map((beat) => ({
            start: beat.start,
            duration: beat.duration,
            narration: beat.narration,
          })),
        })),
      )}
    </output>
  );
}

function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div role="group" aria-label="Thème" className="flex gap-2">
      {THEMES.map(({ name, label }) => (
        <Button
          key={name}
          type="button"
          size="sm"
          variant={theme === name ? "default" : "secondary"}
          aria-pressed={theme === name}
          data-testid={`theme-${name}`}
          onClick={() => setTheme(name)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function FrameField() {
  const { seekToFrame } = usePlayback();
  const [value, setValue] = useState("0");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        seekToFrame(Number(value));
      }}
    >
      <label className="text-caption text-ink-soft" htmlFor="goto-frame">
        Image
      </label>
      <input
        id="goto-frame"
        type="number"
        min={0}
        value={value}
        data-testid="goto-frame"
        onChange={(event) => setValue(event.target.value)}
        className="text-data touch-target w-24 border border-ink bg-transparent px-2 text-ink"
      />
      <Button type="submit" size="sm" variant="secondary" data-testid="goto-submit">
        Aller
      </Button>
    </form>
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
        <ThemeSwitch />
        <DevPlayback document={document}>
          <Planche />
          <Subtitles />
          <Transport />
          <FrameField />
          <TimelineData />
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
