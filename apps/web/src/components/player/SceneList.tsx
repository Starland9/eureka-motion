"use client";

import { useTranslations } from "next-intl";
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { usePlayback, usePlaybackPosition } from "./PlaybackProvider";
import {
  buildSceneEntries,
  formatDuration,
  formatFigureNumber,
  type SceneEntry,
} from "./scene-list-entries";

const NO_DROPPED: readonly number[] = [];

export interface SceneListProps {
  plannedCount?: number;
  dropped?: readonly number[];
  className?: string;
}

interface EntriesProps {
  entries: readonly SceneEntry[];
  onSeek: (position: number) => void;
}

const ROW = "flex items-baseline gap-3 border-l-2 px-3 py-2";

const Entries = memo(function Entries({
  entries,
  onSeek,
  current,
}: EntriesProps & { current: number }) {
  const t = useTranslations("Scenes");
  return (
    <ol aria-label={t("label")} className="border-t border-ink">
      {entries.map((entry) => (
        <li key={entry.number} data-state={entry.kind} className="border-b border-rule">
          {entry.kind === "ready" ? (
            <button
              type="button"
              aria-current={entry.position === current ? "true" : undefined}
              onClick={() => onSeek(entry.position)}
              className={cn(
                ROW,
                "touch-target w-full cursor-pointer text-left hover:bg-surface-sunk",
                entry.position === current ? "border-ink" : "border-transparent",
              )}
            >
              <span className="text-data text-ink-soft">{formatFigureNumber(entry.number)}</span>
              <span className="text-body min-w-0 flex-1 text-pretty break-words">
                {entry.title}
              </span>
              <span className="text-data text-ink-soft">{formatDuration(entry.seconds)}</span>
            </button>
          ) : (
            <div className={cn(ROW, "touch-target border-transparent text-ink-faint")}>
              <span className="text-data">{formatFigureNumber(entry.number)}</span>
              <span className="text-caption">{t(entry.kind)}</span>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
});

function CurrentEntries(props: EntriesProps) {
  const { location } = usePlaybackPosition();
  return <Entries {...props} current={location?.scene.index ?? -1} />;
}

export function SceneList({ plannedCount, dropped = NO_DROPPED, className }: SceneListProps) {
  const t = useTranslations("Scenes");
  const { explanation, timeline, seekToScene } = usePlayback();
  const { scenes } = explanation;
  const entries = useMemo(
    () => buildSceneEntries(scenes, timeline, plannedCount, dropped),
    [scenes, timeline, plannedCount, dropped],
  );
  const ready = scenes.length;
  const total = entries.length;

  return (
    <div data-slot="scene-list" className={cn("flex flex-col gap-3", className)}>
      <p role="status" className="text-caption text-ink-soft">
        {ready === total ? t("complete", { count: ready }) : t("counter", { ready, total })}
      </p>
      <CurrentEntries entries={entries} onSeek={seekToScene} />
    </div>
  );
}
