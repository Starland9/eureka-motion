"use client";

import { useTranslations } from "next-intl";
import { memo, useId, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { SceneTiming } from "scene";
import { cn } from "@/lib/utils";
import { usePlayback, usePlaybackPosition } from "./PlaybackProvider";
import { previousSceneTarget } from "./step-targets";
import {
  clockSeconds,
  formatClock,
  fractionOfFrame,
  frameAtFraction,
  minorTickFrames,
  nextSceneIndex,
  rulerLayout,
  SEEK_STEP_SECONDS,
  totalSeconds,
  type RulerLayout,
} from "./transport-time";

function numeral(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function share(weight: number): { flex: string } {
  return { flex: `${weight} 1 0%` };
}

const Sections = memo(function Sections({
  layout,
  scenes,
  fps,
}: {
  layout: RulerLayout;
  scenes: readonly SceneTiming[];
  fps: number;
}) {
  const hatch = useId().replace(/[^\w-]/g, "");
  const ticks = useMemo(
    () =>
      minorTickFrames(
        scenes.map((scene) => scene.start),
        layout.known,
        fps,
      ),
    [scenes, layout.known, fps],
  );

  return (
    <>
      <div className="flex h-full">
        {scenes.map((scene, index) => (
          <div
            key={scene.id}
            className="relative h-full min-w-0 overflow-hidden"
            style={share(scene.duration)}
          >
            <span className="absolute top-0.5 bottom-3 left-0 w-px bg-ink" />
            <span className="text-caption absolute top-0.5 left-2 text-ink-soft">
              {numeral(index)}
            </span>
            <span className="absolute inset-x-0 bottom-3 h-0.5 bg-ink" />
          </div>
        ))}
        {Array.from({ length: layout.pendingCount }, (_, offset) => (
          <div
            key={`pending-${offset}`}
            className="relative h-full min-w-0 overflow-hidden text-ink-faint"
            style={share(layout.pendingWeight)}
          >
            <span className="absolute top-0.5 bottom-3 left-0 w-px bg-ink-faint" />
            <span className="text-caption absolute top-0.5 left-2">
              {numeral(scenes.length + offset)}
            </span>
            <svg
              aria-hidden="true"
              focusable="false"
              className="absolute inset-x-0 bottom-2.5 h-1.5 w-full border-y border-ink-faint"
            >
              <defs>
                <pattern
                  id={hatch}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <path d="M0 0V6" stroke="currentColor" strokeWidth="1.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#${hatch})`} />
            </svg>
          </div>
        ))}
      </div>
      {ticks.map((frame) => (
        <span
          key={frame}
          className="absolute bottom-3 h-1.5 w-px bg-ink"
          style={{ left: `${(frame / layout.total) * 100}%` }}
        />
      ))}
      <span
        className={cn(
          "absolute top-0.5 right-0 bottom-3 w-px",
          layout.pendingCount > 0 ? "bg-ink-faint" : "bg-ink",
        )}
      />
    </>
  );
});

function Track({
  layout,
  plannedSceneCount,
  children,
}: {
  layout: RulerLayout;
  plannedSceneCount: number;
  children: ReactNode;
}) {
  const t = useTranslations("Transport");
  const playback = usePlayback();
  const { frame, location } = usePlaybackPosition();
  const { timeline, fps, ended, reducedMotion, seekToFrame, seekToScene } = playback;
  const scenes = timeline.scenes;
  const disabled = scenes.length === 0;

  const maxSeconds = totalSeconds(layout.known, fps);
  const nowSeconds = clockSeconds(frame, ended, layout.known, fps);
  const edge = ended ? layout.known : frame;
  const percent = `${fractionOfFrame(edge, layout) * 100}%`;

  const valueText = disabled
    ? t("rulerEmpty")
    : t("rulerValue", {
        scene: (location?.scene.index ?? 0) + 1,
        total: Math.max(scenes.length, plannedSceneCount),
        elapsed: formatClock(nowSeconds),
        duration: formatClock(maxSeconds),
        pending: layout.pendingCount,
      });

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>, clampToKnown: boolean): boolean => {
    const rect = event.currentTarget.getBoundingClientRect();
    const target = frameAtFraction((event.clientX - rect.left) / rect.width, layout, clampToKnown);
    if (target === null) return false;
    seekToFrame(target);
    return true;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0) return;
    if (seekFromPointer(event, false)) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekFromPointer(event, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = SEEK_STEP_SECONDS * fps;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        seekToFrame(frame - step);
        break;
      case "ArrowRight":
      case "ArrowUp":
        seekToFrame(frame + step);
        break;
      case "Home":
        seekToFrame(0);
        break;
      case "End":
        seekToFrame(layout.known - 1);
        break;
      case "PageUp": {
        const index = previousSceneTarget(scenes, frame, fps, reducedMotion);
        if (index !== null) seekToScene(index);
        break;
      }
      case "PageDown": {
        const index = nextSceneIndex(scenes, frame);
        if (index !== null) seekToScene(index);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={t("ruler")}
      aria-valuemin={0}
      aria-valuemax={maxSeconds}
      aria-valuenow={nowSeconds}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      className={cn(
        "relative h-11 w-full touch-none select-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute bottom-2.5 left-0 h-1.5 bg-ink"
        style={{ width: percent }}
      />
      <span aria-hidden="true" className="absolute inset-y-0 w-0" style={{ left: percent }}>
        <span className="absolute top-5 bottom-0 -left-px w-0.5 bg-ink" />
        <span className="absolute -left-2 bottom-1.25 size-4 border-2 border-ink bg-surface-raised" />
      </span>
    </div>
  );
}

export function Ruler({ plannedSceneCount }: { plannedSceneCount: number }) {
  const { timeline, fps } = usePlayback();
  const durations = useMemo(() => timeline.scenes.map((scene) => scene.duration), [timeline]);
  const layout = useMemo(
    () => rulerLayout(durations, plannedSceneCount),
    [durations, plannedSceneCount],
  );

  return (
    <Track layout={layout} plannedSceneCount={plannedSceneCount}>
      <Sections layout={layout} scenes={timeline.scenes} fps={fps} />
    </Track>
  );
}
