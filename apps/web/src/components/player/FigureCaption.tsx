"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { Scene } from "scene";
import { cn } from "@/lib/utils";
import { usePlayback, usePlaybackPosition } from "./PlaybackProvider";
import { formatFigureNumber, sceneSlots } from "./scene-list-entries";

export interface FigureCaptionProps {
  className?: string;
}

interface CurrentCaptionProps {
  scenes: readonly Scene[];
  slots: readonly number[];
  className?: string;
}

function CurrentCaption({ scenes, slots, className }: CurrentCaptionProps) {
  const t = useTranslations("Scenes");
  const { location } = usePlaybackPosition();
  const scene = location ? scenes[location.scene.index] : undefined;
  const slot = location ? slots[location.scene.index] : undefined;
  if (!scene || slot === undefined) return null;
  return (
    <p data-slot="figure-caption" className={cn("text-caption text-ink-soft", className)}>
      {t("figure", { number: formatFigureNumber(slot + 1), title: scene.title })}
    </p>
  );
}

export function FigureCaption({ className }: FigureCaptionProps) {
  const { scenes } = usePlayback().explanation;
  const slots = useMemo(() => sceneSlots(scenes), [scenes]);
  return <CurrentCaption scenes={scenes} slots={slots} className={className} />;
}
