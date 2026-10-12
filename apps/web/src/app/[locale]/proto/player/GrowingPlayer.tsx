"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { CANVAS, FPS, type ExplanationDocument } from "scene";
import { Explanation, explanationDurationInFrames } from "scene/player";
import { useGrowingPlayback } from "@/components/player/useGrowingPlayback";

const BEAT_MS = 1000;
const ARRIVAL_MS = 5000;

interface LogEntry {
  at: number;
  event: string;
  frame: number;
  duration: number;
}

export function GrowingPlayer({ document }: { document: ExplanationDocument }) {
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const started = useRef(0);
  const [count, setCount] = useState(1);
  const [log, setLog] = useState<LogEntry[]>([]);

  const allScenes = useMemo(
    () =>
      document.scenes.slice(0, 4).map((scene) => ({
        ...scene,
        beats: scene.beats.map((beat) => ({ ...beat, duration_ms: BEAT_MS })),
      })),
    [document],
  );
  const scenes = useMemo(() => allScenes.slice(0, count), [allScenes, count]);
  const duration = explanationDurationInFrames(scenes);
  const complete = count >= allScenes.length;
  const { waiting } = useGrowingPlayback(player, duration, complete);
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const inputProps = useMemo(
    () => ({
      scenes,
      params: document.params,
      model: document.model,
      language: "fr" as const,
      theme: "paper" as const,
    }),
    [scenes, document],
  );

  useEffect(() => {
    started.current = performance.now();
    const requested = Number(new URLSearchParams(window.location.search).get("arrival"));
    const timer = setInterval(
      () => setCount((value) => Math.min(value + 1, allScenes.length)),
      requested > 0 ? requested : ARRIVAL_MS,
    );
    return () => clearInterval(timer);
  }, [allScenes.length]);

  useEffect(() => {
    if (!player) return;
    const record = (event: string) => (): void => {
      setLog((entries) => [
        ...entries,
        {
          at: Math.round(performance.now() - started.current),
          event,
          frame: player.getCurrentFrame(),
          duration: durationRef.current,
        },
      ]);
    };
    const names = ["play", "pause", "ended", "seeked"] as const;
    const handlers = names.map((name) => [name, record(name)] as const);
    for (const [name, handler] of handlers) player.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of handlers) player.removeEventListener(name, handler);
    };
  }, [player]);

  return (
    <main>
      <Player
        ref={setPlayer}
        component={Explanation}
        inputProps={inputProps}
        durationInFrames={duration}
        compositionWidth={CANVAS.width}
        compositionHeight={CANVAS.height}
        fps={FPS}
        style={{ width: 960 }}
        acknowledgeRemotionLicense
      />
      <button type="button" data-testid="play" onClick={(event) => player?.play(event)}>
        play
      </button>
      <output data-testid="status">
        {JSON.stringify({ scenes: count, duration, waiting, complete })}
      </output>
      <pre data-testid="log">{JSON.stringify(log)}</pre>
    </main>
  );
}
