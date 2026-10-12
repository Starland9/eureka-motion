"use client";

import type { PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState, type RefObject } from "react";

export interface GrowingPlayback {
  waiting: boolean;
}

export function useGrowingPlayback(
  ref: RefObject<PlayerRef | null>,
  durationInFrames: number,
  complete: boolean,
): GrowingPlayback {
  const waitingFrom = useRef<number | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onEnded = (): void => {
      if (complete) return;
      waitingFrom.current = durationInFrames;
      setWaiting(true);
    };
    player.addEventListener("ended", onEnded);
    return () => player.removeEventListener("ended", onEnded);
  }, [ref, durationInFrames, complete]);

  useEffect(() => {
    const player = ref.current;
    const from = waitingFrom.current;
    if (!player || from === null || durationInFrames <= from) return;
    waitingFrom.current = null;
    setWaiting(false);
    player.seekTo(from);
    player.play();
  }, [ref, durationInFrames]);

  useEffect(() => {
    if (complete && waitingFrom.current !== null) {
      waitingFrom.current = null;
      setWaiting(false);
    }
  }, [complete]);

  return { waiting };
}
