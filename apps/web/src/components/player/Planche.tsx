"use client";

import { Player } from "@remotion/player";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CANVAS } from "scene";
import { Explanation } from "scene/player";
import { cn } from "@/lib/utils";
import { usePlayback, usePlayerAttach } from "./PlaybackProvider";

const CORNERS = [
  "left-0 top-0 -translate-x-full -translate-y-full border-b border-r",
  "right-0 top-0 translate-x-full -translate-y-full border-b border-l",
  "bottom-0 left-0 -translate-x-full translate-y-full border-r border-t",
  "bottom-0 right-0 translate-x-full translate-y-full border-l border-t",
];

export interface PlancheProps {
  className?: string;
  overlay?: ReactNode;
}

export function Planche({ className, overlay }: PlancheProps) {
  const t = useTranslations("Planche");
  const playback = usePlayback();
  const attachPlayer = usePlayerAttach();
  const empty = playback.explanation.scenes.length === 0;

  return (
    <div className={cn("relative m-3 sm:m-4", className)}>
      {CORNERS.map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          className={cn("absolute size-3 border-ink sm:size-4", corner)}
        />
      ))}
      <div
        className="relative aspect-video w-full overflow-hidden border-2 border-ink bg-surface-raised"
        onClick={(event) => {
          if (!empty) playback.toggle(event);
        }}
      >
        <Player
          ref={attachPlayer}
          component={Explanation}
          inputProps={playback.inputProps}
          durationInFrames={playback.durationInFrames}
          compositionWidth={CANVAS.width}
          compositionHeight={CANVAS.height}
          fps={playback.fps}
          style={{ width: "100%", height: "100%" }}
          controls={false}
          clickToPlay={false}
          doubleClickToFullscreen
          spaceKeyToPlayOrPause={false}
          acknowledgeRemotionLicense
        />
        {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
        {playback.waiting && !empty ? (
          <p
            role="status"
            className="absolute bottom-0 left-0 bg-surface-raised px-3 py-2 text-caption text-ink-faint"
          >
            {t("waiting")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
