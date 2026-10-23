"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  buildScope,
  computeSceneState,
  toModelDefinition,
  withSceneValues,
  type Language,
  type Location,
  type Model,
  type Param,
  type Scene,
  type ThemeName,
} from "scene";
import type { ExplanationProps } from "scene/player";
import { clampToRange, currentValue } from "@/components/controls/params-values";

type Values = Readonly<Record<string, number>>;

const NONE: Values = Object.freeze({});

export interface ParamsState {
  values: Values;
  adjusting: boolean;
  // Scene whose sweeps the student has taken over; they stay off until the scene ends or a reset.
  kept: string | null;
}

export type ParamsAction =
  | { type: "set"; id: string; value: number }
  | { type: "take"; scene: string; animated: Values }
  | { type: "adjust"; adjusting: boolean }
  | { type: "leave" }
  | { type: "reset" };

export const initialParamsState: ParamsState = { values: NONE, adjusting: false, kept: null };

export function paramsReducer(state: ParamsState, action: ParamsAction): ParamsState {
  switch (action.type) {
    case "set":
      if (state.values[action.id] === action.value) return state;
      return { ...state, values: { ...state.values, [action.id]: action.value } };
    case "take": {
      if (state.kept === action.scene) return state;
      const grabbed = Object.keys(action.animated).length > 0;
      return {
        ...state,
        kept: action.scene,
        values: grabbed ? { ...state.values, ...action.animated } : state.values,
      };
    }
    case "adjust":
      return state.adjusting === action.adjusting
        ? state
        : { ...state, adjusting: action.adjusting };
    case "leave":
      return state.kept === null ? state : { ...state, kept: null };
    case "reset":
      return state.kept === null && state.values === NONE
        ? state
        : { ...state, values: NONE, kept: null };
  }
}

function sweepsAt(scene: Scene, beat: number): boolean {
  return scene.beats.some(
    (candidate, index) =>
      index <= beat &&
      candidate.actions.some(
        (action) => action.do === "sweep" && (index === beat || action.hold === true),
      ),
  );
}

export function animatedValues(props: ExplanationProps, location: Location | null): Values {
  if (location === null || props.disableSweeps || props.reducedMotion) return NONE;
  const scene = props.scenes[location.scene.index];
  if (scene === undefined || !sweepsAt(scene, location.beat.index)) return NONE;

  const values = props.values ?? NONE;
  const definition = toModelDefinition(
    withSceneValues({ params: props.params, model: props.model }, scene),
  );
  const state = computeSceneState({
    scene,
    timing: location.scene,
    frame: location.frameInScene,
    baseScope: buildScope(definition, values),
    params: values,
  });

  let animated: Record<string, number> | null = null;
  for (const param of props.params) {
    const raw = state.paramValues[param.id];
    if (raw === undefined) continue;
    const value = clampToRange(raw, param);
    if (value === currentValue(param, values)) continue;
    animated ??= {};
    animated[param.id] = value;
  }
  return animated ?? NONE;
}

export function shownValues(props: ExplanationProps, location: Location | null): Values {
  const values = props.values ?? NONE;
  const animated = animatedValues(props, location);
  return animated === NONE ? values : { ...values, ...animated };
}

export interface ParamsInput {
  scenes: readonly Scene[];
  params: readonly Param[];
  model: Model;
  language: Language;
  theme: ThemeName;
  reducedMotion: boolean;
  location: Location | null;
}

export interface ParamsLink {
  values: Values;
  inputProps: ExplanationProps;
  setValue(id: string, value: number): void;
  resetValues(): void;
  setAdjusting(adjusting: boolean): void;
}

export function useParams(input: ParamsInput): ParamsLink {
  const { scenes, params, model, language, theme, reducedMotion, location } = input;
  const [state, dispatch] = useReducer(paramsReducer, initialParamsState);

  const sceneId = location?.scene.id ?? null;
  if (state.kept !== null && state.kept !== sceneId) dispatch({ type: "leave" });

  const { values, adjusting } = state;
  const disableSweeps = adjusting || state.kept !== null;

  const inputProps = useMemo<ExplanationProps>(
    () => ({ scenes, params, model, language, theme, values, reducedMotion, disableSweeps }),
    [scenes, params, model, language, theme, values, reducedMotion, disableSweeps],
  );

  const latest = useRef({ inputProps, location });
  useEffect(() => {
    latest.current = { inputProps, location };
  });

  const take = useCallback(() => {
    const { inputProps: props, location: at } = latest.current;
    const scene = at === null ? undefined : props.scenes[at.scene.index];
    if (at === null || scene === undefined || !sweepsAt(scene, at.beat.index)) return;
    dispatch({ type: "take", scene: at.scene.id, animated: animatedValues(props, at) });
  }, []);

  const setValue = useCallback(
    (id: string, value: number) => {
      take();
      dispatch({ type: "set", id, value });
    },
    [take],
  );
  const resetValues = useCallback(() => dispatch({ type: "reset" }), []);
  const setAdjusting = useCallback(
    (next: boolean) => {
      if (next) take();
      dispatch({ type: "adjust", adjusting: next });
    },
    [take],
  );

  return { values, inputProps, setValue, resetValues, setAdjusting };
}
