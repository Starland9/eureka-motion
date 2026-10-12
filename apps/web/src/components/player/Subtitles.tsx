"use client";

import { cn } from "@/lib/utils";
import { usePlayback, usePlaybackPosition } from "./PlaybackProvider";

export interface SubtitlesProps {
  className?: string;
}

function Narration() {
  const { location } = usePlaybackPosition();
  return location?.beat.narration ?? null;
}

export function Subtitles({ className }: SubtitlesProps) {
  const { captions, explanation } = usePlayback();
  return (
    <div
      data-slot="subtitles"
      lang={explanation.language}
      className={cn(
        "text-body-l mx-auto min-h-[2lh] max-w-[60ch] text-center text-balance",
        className,
      )}
    >
      {captions ? <Narration /> : null}
    </div>
  );
}
