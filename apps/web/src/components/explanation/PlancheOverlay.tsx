"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePlayback } from "@/components/player/PlaybackProvider";
import { ConstructionLines } from "./ConstructionLines";

export function PlancheOverlay({ preparing, autoPlay }: { preparing: boolean; autoPlay: boolean }) {
  const t = useTranslations("Explanation");
  const playback = usePlayback();
  const [played, setPlayed] = useState(false);
  if (playback.playing && !played) setPlayed(true);

  if (preparing) return <ConstructionLines />;

  const waitsForPress = !autoPlay || playback.reducedMotion;
  const hasScene = playback.explanation.scenes.length > 0;
  if (!waitsForPress || played || !hasScene || !playback.ready) return null;

  return (
    <div className="flex h-full items-center justify-center">
      <Button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          playback.play(event);
        }}
      >
        {t("play")}
      </Button>
    </div>
  );
}
