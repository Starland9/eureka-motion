"use client";

import { memo, useMemo } from "react";
import { Params } from "@/components/controls/Params";
import { deriveResults } from "@/components/controls/params-values";
import { usePlayback, usePlaybackPosition } from "./PlaybackProvider";
import { shownValues } from "./useParams";

// Repainting every frame is only needed while a sweep moves the sliders.
const ParamsView = memo(Params);

export function ParamsPanel({ className }: { className?: string }) {
  const playback = usePlayback();
  const { location } = usePlaybackPosition();
  const { params, model } = playback.explanation;
  const shown = shownValues(playback.inputProps, location);
  const results = useMemo(() => deriveResults(params, model, shown), [params, model, shown]);

  return (
    <ParamsView
      params={params}
      values={shown}
      results={results}
      onChange={playback.setValue}
      onReset={playback.resetValues}
      onAdjustingChange={playback.setAdjusting}
      className={className}
    />
  );
}
