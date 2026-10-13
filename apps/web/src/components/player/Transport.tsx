"use client";

import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useMemo, useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { usePlayback, usePlaybackPosition, type PlaybackControls } from "./PlaybackProvider";
import {
  beatEndFrames,
  nextStepFrame,
  previousSceneTarget,
  previousStepFrame,
} from "./step-targets";
import {
  FullscreenGlyph,
  NextGlyph,
  PauseGlyph,
  PlayGlyph,
  PreviousGlyph,
  ReplayGlyph,
  SoundGlyph,
} from "./transport-glyphs";
import { handledByTarget, isRepeatable, shortcutFor, targetKind } from "./transport-keys";
import { Ruler } from "./transport-ruler";
import {
  clockSeconds,
  formatClock,
  nextSceneIndex,
  SEEK_STEP_SECONDS,
  totalSeconds,
} from "./transport-time";

const PRESSED =
  "aria-pressed:enabled:bg-ink aria-pressed:enabled:text-surface aria-pressed:enabled:hover:bg-ink";
const STEP_UNAVAILABLE =
  "aria-disabled:cursor-default aria-disabled:border aria-disabled:border-ink-faint aria-disabled:bg-transparent aria-disabled:text-ink-faint aria-disabled:hover:bg-transparent aria-disabled:hover:no-underline aria-disabled:active:translate-y-0";

type OnStep = (landed: number | null) => void;

export interface TransportProps {
  plannedSceneCount?: number;
  shortcuts?: boolean;
  className?: string;
}

function togglePlayback(playback: PlaybackControls, event?: SyntheticEvent): void {
  if (!playback.playing && playback.ended && !playback.waiting) {
    playback.seekToFrame(0);
    playback.play(event);
    return;
  }
  playback.toggle(event);
}

function toggleFullscreen(playback: PlaybackControls): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen();
    else playback.requestFullscreen();
  } catch {
    // The player throws when the browser has no fullscreen support.
  }
}

function PlayButton() {
  const t = useTranslations("Transport");
  const playback = usePlayback();
  const replay = playback.ended && !playback.waiting;
  const name = playback.playing ? t("pause") : replay ? t("replay") : t("play");

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={name}
      title={name}
      aria-keyshortcuts="Space"
      disabled={playback.explanation.scenes.length === 0}
      onClick={(event) => togglePlayback(playback, event)}
    >
      {playback.playing ? <PauseGlyph /> : replay ? <ReplayGlyph /> : <PlayGlyph />}
    </Button>
  );
}

function SceneStep({ direction }: { direction: "previous" | "next" }) {
  const t = useTranslations("Transport");
  const { timeline, fps, seekToScene, reducedMotion } = usePlayback();
  const { frame } = usePlaybackPosition();
  const previous = direction === "previous";
  const target = previous
    ? previousSceneTarget(timeline.scenes, frame, fps, reducedMotion)
    : nextSceneIndex(timeline.scenes, frame);
  const name = previous ? t("previousScene") : t("nextScene");

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={name}
      title={name}
      disabled={target === null}
      onClick={() => {
        if (target !== null) seekToScene(target);
      }}
    >
      {previous ? <PreviousGlyph /> : <NextGlyph />}
    </Button>
  );
}

function StepButton({ direction, onStep }: { direction: "previous" | "next"; onStep: OnStep }) {
  const t = useTranslations("Transport");
  const playback = usePlayback();
  const { frame } = usePlaybackPosition();
  const ends = useMemo(() => beatEndFrames(playback.timeline.scenes), [playback.timeline]);
  const forward = direction === "next";
  const available =
    (forward ? nextStepFrame(ends, frame) : previousStepFrame(ends, frame)) !== null;

  return (
    <Button
      type="button"
      variant={forward ? "default" : "secondary"}
      size="sm"
      aria-disabled={!available || undefined}
      aria-keyshortcuts={forward ? "N" : "P"}
      className={available ? undefined : STEP_UNAVAILABLE}
      onClick={() => {
        if (available) onStep(forward ? playback.stepForward() : playback.stepBack());
      }}
    >
      {forward ? t("stepNext") : t("stepPrevious")}
    </Button>
  );
}

function StepNarration({ stepped }: { stepped: number | null }) {
  const { explanation, playing } = usePlayback();
  const { frame, location } = usePlaybackPosition();
  const announce = stepped !== null && frame === stepped && !playing;

  return (
    <p role="status" lang={explanation.language} className="sr-only">
      {announce ? (location?.beat.narration ?? "") : ""}
    </p>
  );
}

function Time() {
  const t = useTranslations("Transport");
  const { durationInFrames, fps, ended, explanation } = usePlayback();
  const { frame } = usePlaybackPosition();
  const elapsed = formatClock(clockSeconds(frame, ended, durationInFrames, fps));
  const total = formatClock(totalSeconds(durationInFrames, fps));

  return (
    <span className="text-data min-w-[13ch] px-2 whitespace-nowrap text-ink-soft">
      {t(explanation.complete ? "time" : "timePartial", { elapsed, total })}
    </span>
  );
}

function CaptionsButton() {
  const t = useTranslations("Transport");
  const { captions, setCaptions, explanation } = usePlayback();
  const name = t("captions");

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={name}
      title={name}
      aria-pressed={captions}
      aria-keyshortcuts="C"
      disabled={explanation.scenes.length === 0}
      className={PRESSED}
      onClick={() => setCaptions(!captions)}
    >
      <span aria-hidden="true" className="text-caption">
        {t("captionsShort")}
      </span>
    </Button>
  );
}

function SoundControl() {
  const t = useTranslations("Transport");
  const { muted, setMuted, volume, setVolume, explanation } = usePlayback();
  const empty = explanation.scenes.length === 0;
  const level = muted ? 0 : volume;
  const name = t("sound");

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={name}
        title={name}
        aria-pressed={!muted}
        aria-keyshortcuts="M"
        disabled={empty}
        className={PRESSED}
        onClick={() => setMuted(!muted)}
      >
        <SoundGlyph muted={muted} />
      </Button>
      <Slider
        className="w-28 [&_[data-slot=slider-range]]:bg-ink"
        min={0}
        max={1}
        step={0.05}
        value={[level]}
        disabled={empty}
        aria-label={t("volume")}
        aria-valuetext={t("volumeValue", { value: Math.round(level * 100) })}
        onValueChange={(values) => {
          const next = values[0] ?? 0;
          setVolume(next);
          if (next > 0 && muted) setMuted(false);
        }}
      />
    </>
  );
}

function FullscreenButton() {
  const t = useTranslations("Transport");
  const playback = usePlayback();
  const name = t("fullscreen");

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={name}
      title={name}
      aria-keyshortcuts="F"
      disabled={playback.explanation.scenes.length === 0}
      onClick={() => toggleFullscreen(playback)}
    >
      <FullscreenGlyph />
    </Button>
  );
}

function Shortcuts({ onStep }: { onStep: OnStep }) {
  const playback = usePlayback();
  const { frame } = usePlaybackPosition();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (playback.explanation.scenes.length === 0 || event.defaultPrevented || event.isComposing) {
      return;
    }
    const shortcut = shortcutFor(event);
    if (!shortcut || handledByTarget(targetKind(event.target), shortcut)) return;
    if (event.repeat && !isRepeatable(shortcut)) return;
    const stepping = shortcut === "stepNext" || shortcut === "stepPrevious";
    if (stepping && !playback.reducedMotion) return;
    event.preventDefault();
    const step = SEEK_STEP_SECONDS * playback.fps;
    switch (shortcut) {
      case "toggle":
        togglePlayback(playback);
        break;
      case "back":
        playback.seekToFrame(frame - step);
        break;
      case "forward":
        playback.seekToFrame(frame + step);
        break;
      case "mute":
        playback.setMuted(!playback.muted);
        break;
      case "captions":
        playback.setCaptions(!playback.captions);
        break;
      case "fullscreen":
        toggleFullscreen(playback);
        break;
      case "stepNext":
        onStep(playback.stepForward());
        break;
      case "stepPrevious":
        onStep(playback.stepBack());
        break;
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return null;
}

export function Transport({ plannedSceneCount = 0, shortcuts = true, className }: TransportProps) {
  const t = useTranslations("Transport");
  const { reducedMotion } = usePlayback();
  const [stepped, setStepped] = useState<number | null>(null);

  return (
    <div role="group" aria-label={t("label")} className={cn("flex flex-col gap-2", className)}>
      <Ruler plannedSceneCount={plannedSceneCount} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {reducedMotion ? (
            <>
              <StepButton direction="previous" onStep={setStepped} />
              <StepButton direction="next" onStep={setStepped} />
              <PlayButton />
              <SceneStep direction="previous" />
              <SceneStep direction="next" />
            </>
          ) : (
            <>
              <SceneStep direction="previous" />
              <PlayButton />
              <SceneStep direction="next" />
            </>
          )}
          <Time />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CaptionsButton />
          <SoundControl />
          <FullscreenButton />
        </div>
      </div>
      {reducedMotion ? <StepNarration stepped={stepped} /> : null}
      {shortcuts ? <Shortcuts onStep={setStepped} /> : null}
    </div>
  );
}
