"use client";

import type { PlayerRef } from "@remotion/player";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  buildTimeline,
  FPS,
  locate,
  type Language,
  type Location,
  type Model,
  type Param,
  type Scene,
  type ThemeName,
  type Timeline,
} from "scene";
import type { ExplanationProps } from "scene/player";
import { useFontsReady } from "@/lib/fonts-ready";
import { useFlagPreference } from "@/lib/preferences";
import { useReducedMotion, useTheme } from "@/lib/theme-client";
import { beatEndFrames, nextStepFrame, previousStepFrame, sceneLandingFrame } from "./step-targets";
import { useGrowingPlayback } from "./useGrowingPlayback";
import { useParams } from "./useParams";

export interface PlayableExplanation {
  scenes: readonly Scene[];
  params: readonly Param[];
  model: Model;
  language: Language;
  complete: boolean;
}

export interface PlaybackControls {
  explanation: PlayableExplanation;
  timeline: Timeline;
  durationInFrames: number;
  fps: number;
  inputProps: ExplanationProps;
  theme: ThemeName;
  reducedMotion: boolean;
  ready: boolean;
  playing: boolean;
  waiting: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  captions: boolean;
  values: Readonly<Record<string, number>>;
  play(event?: SyntheticEvent): void;
  pause(): void;
  toggle(event?: SyntheticEvent): void;
  seekToFrame(frame: number): void;
  seekToScene(index: number): void;
  stepForward(): number | null;
  stepBack(): number | null;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  setCaptions(visible: boolean): void;
  requestFullscreen(): void;
  playerElement(): HTMLElement | null;
  setValue(id: string, value: number): void;
  resetValues(): void;
  setAdjusting(adjusting: boolean): void;
}

export interface PlaybackPosition {
  frame: number;
  location: Location | null;
}

type AttachPlayer = (player: PlayerRef | null) => void;

const AttachContext = createContext<AttachPlayer | null>(null);
const ControlsContext = createContext<PlaybackControls | null>(null);
const PositionContext = createContext<PlaybackPosition>({ frame: 0, location: null });

const AUTOPLAY_SETTLE_MS = 200;
const STALL_CHECK_MS = 1500;
const STALL_REPLAY_MS = 50;
const STALL_NUDGES = 2;

const CAPTIONS_KEY = "eureka.captions";
const MUTED_KEY = "eureka.muted";

export interface PlaybackProviderProps {
  explanation: PlayableExplanation;
  autoPlay?: boolean;
  children: ReactNode;
}

export function PlaybackProvider({
  explanation,
  autoPlay = true,
  children,
}: PlaybackProviderProps) {
  const [player, attachPlayer] = useState<PlayerRef | null>(null);
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const fontsReady = useFontsReady();
  const { scenes, params, model, language, complete } = explanation;

  const timeline = useMemo(() => buildTimeline(scenes, FPS), [scenes]);
  const durationInFrames = Math.max(1, timeline.duration);
  // Resuming when scenes arrive would start playback without a press.
  const { waiting } = useGrowingPlayback(reducedMotion ? null : player, durationInFrames, complete);

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [mutedChoice, setMutedChoice] = useFlagPreference(MUTED_KEY, false);
  const [silenced, setSilenced] = useState(false);
  const muted = mutedChoice || silenced;
  const setMuted = useCallback(
    (next: boolean) => {
      setSilenced(false);
      setMutedChoice(next);
    },
    [setMutedChoice],
  );
  const [captions, setCaptions] = useFlagPreference(CAPTIONS_KEY, true);
  const [volume, setVolumeState] = useState(1);
  const location = useMemo(() => locate(timeline, frame), [frame, timeline]);
  const { values, inputProps, setValue, resetValues, setAdjusting } = useParams({
    scenes,
    params,
    model,
    language,
    theme,
    reducedMotion,
    location,
  });

  useEffect(() => {
    if (!player) return;
    if (muted) player.mute();
    else player.unmute();
  }, [player, muted]);

  useEffect(() => {
    if (!player) return;
    // Remotion emits this from a passive effect; a synchronous setState there trips React's
    // nested-update warning after about 50 frames of playback.
    const onFrame = (event: { detail: { frame: number } }): void =>
      queueMicrotask(() => setFrame(event.detail.frame));
    const onPlay = (): void => {
      setPlaying(true);
      setEnded(false);
    };
    const onPause = (): void => setPlaying(false);
    const onEnded = (): void => setEnded(true);
    const onSeeked = (): void => setEnded(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    player.addEventListener("seeked", onSeeked);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("seeked", onSeeked);
    };
  }, [player]);

  const hasScene = scenes.length > 0;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!player || !hasScene || !fontsReady || autoStarted.current) return;
    if (!autoPlay || reducedMotion) return;
    // A play order given in the commit that mounts the first scene and its audio is lost
    // by the player: it is given once the scene has settled.
    const timer = setTimeout(() => {
      autoStarted.current = true;
      player.play();
    }, AUTOPLAY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [player, hasScene, fontsReady, autoPlay, reducedMotion]);

  // The player can report that it plays while its frame stands still, waiting for audio
  // that will not start. Playing again clears it; failing that, it goes on without sound.
  const stallNudges = useRef(0);
  useEffect(() => {
    if (!player || !playing || waiting) return;
    let last = player.getCurrentFrame();
    const timer = setInterval(() => {
      const now = player.getCurrentFrame();
      if (!player.isPlaying()) return;
      if (now !== last) {
        last = now;
        stallNudges.current = 0;
        return;
      }
      stallNudges.current += 1;
      if (stallNudges.current <= STALL_NUDGES) {
        player.pause();
        setTimeout(() => player.play(), STALL_REPLAY_MS);
      } else {
        setSilenced(true);
      }
    }, STALL_CHECK_MS);
    return () => clearInterval(timer);
  }, [player, playing, waiting]);

  const landed = useRef(false);
  useEffect(() => {
    const first = timeline.scenes[0];
    if (!player || !first || !reducedMotion || landed.current) return;
    landed.current = true;
    player.seekTo(sceneLandingFrame(first, true));
  }, [player, timeline, reducedMotion]);

  const stepEnds = useMemo(() => beatEndFrames(timeline.scenes), [timeline]);

  const play = useCallback((event?: SyntheticEvent) => player?.play(event), [player]);
  const pause = useCallback(() => player?.pause(), [player]);
  const toggle = useCallback((event?: SyntheticEvent) => player?.toggle(event), [player]);
  const seekToFrame = useCallback(
    (target: number) =>
      player?.seekTo(Math.min(Math.max(0, Math.round(target)), durationInFrames - 1)),
    [player, durationInFrames],
  );
  const seekToScene = useCallback(
    (index: number) => {
      const scene = timeline.scenes[index];
      if (scene) player?.seekTo(sceneLandingFrame(scene, reducedMotion));
    },
    [player, timeline, reducedMotion],
  );
  const stepTo = useCallback(
    (target: number | null) => {
      if (!player || target === null) return null;
      player.pause();
      player.seekTo(target);
      return target;
    },
    [player],
  );
  const stepForward = useCallback(
    () => stepTo(player ? nextStepFrame(stepEnds, player.getCurrentFrame()) : null),
    [player, stepEnds, stepTo],
  );
  const stepBack = useCallback(
    () => stepTo(player ? previousStepFrame(stepEnds, player.getCurrentFrame()) : null),
    [player, stepEnds, stepTo],
  );
  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.min(1, Math.max(0, next));
      player?.setVolume(clamped);
      setVolumeState(clamped);
    },
    [player],
  );
  const requestFullscreen = useCallback(() => player?.requestFullscreen(), [player]);
  const playerElement = useCallback(() => player?.getContainerNode() ?? null, [player]);

  const controls = useMemo<PlaybackControls>(
    () => ({
      explanation,
      timeline,
      durationInFrames,
      fps: FPS,
      inputProps,
      theme,
      reducedMotion,
      ready: player !== null,
      playing,
      waiting,
      ended,
      muted,
      volume,
      captions,
      values,
      play,
      pause,
      toggle,
      seekToFrame,
      seekToScene,
      stepForward,
      stepBack,
      setMuted,
      setVolume,
      setCaptions,
      requestFullscreen,
      playerElement,
      setValue,
      resetValues,
      setAdjusting,
    }),
    [
      explanation,
      timeline,
      durationInFrames,
      inputProps,
      theme,
      reducedMotion,
      player,
      playing,
      waiting,
      ended,
      muted,
      volume,
      captions,
      values,
      play,
      pause,
      toggle,
      seekToFrame,
      seekToScene,
      stepForward,
      stepBack,
      setMuted,
      setVolume,
      setCaptions,
      requestFullscreen,
      playerElement,
      setValue,
      resetValues,
      setAdjusting,
    ],
  );

  const position = useMemo<PlaybackPosition>(() => ({ frame, location }), [frame, location]);

  return (
    <AttachContext.Provider value={attachPlayer}>
      <ControlsContext.Provider value={controls}>
        <PositionContext.Provider value={position}>{children}</PositionContext.Provider>
      </ControlsContext.Provider>
    </AttachContext.Provider>
  );
}

export function usePlayerAttach(): AttachPlayer {
  const attach = useContext(AttachContext);
  if (!attach) throw new Error("usePlayerAttach must be used inside a PlaybackProvider");
  return attach;
}

export function usePlayback(): PlaybackControls {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error("usePlayback must be used inside a PlaybackProvider");
  return controls;
}

export function usePlaybackPosition(): PlaybackPosition {
  return useContext(PositionContext);
}
