import {
  buildScope,
  defaultParamValues,
  DEFAULT_FORMAT,
  parseFormat,
  type Language,
  type ModelDefinition,
} from "../expr";
import { createFrame, createProjection, layoutSlots, type Frame, type Rect } from "../layouts";
import type { Model, Param, Scene, SceneElement, SlotName } from "../schema/document";
import { elementLookup } from "../schema/geometry";
import { splitTarget } from "../schema/inspect";
import { toModelDefinition, withSceneValues, type ModelSource } from "../schema/model-scope";
import {
  durationsMs,
  ease,
  fontStacks,
  SCENE_DISPLAY_OPTICAL_SIZE,
  getTheme,
  msToFrames,
  sceneMetrics,
  type Theme,
  type ThemeName,
} from "../tokens";
import type { SceneContext, ValueInfo } from "./context";
import { stackScale } from "../primitives/text/fit";
import { registry } from "./registry";
import { computeSceneState } from "./state";
import type { SceneTiming } from "./timeline";

export interface SceneFrameProps {
  scene: Scene;
  timing: SceneTiming;
  params: readonly Param[];
  model: Model;
  language: Language;
  theme: ThemeName;
  values: Readonly<Record<string, number>>;
  reducedMotion: boolean;
  disableSweeps: boolean;
  burnSubtitles: boolean;
  frame: number;
  width: number;
  height: number;
  fps: number;
}

const LONG_TITLE_CHARS = 28;
const SHORT_TITLE_U = 7;
const LONG_TITLE_U = 5;
const HTML_GAP_U = 2.5;
const SUBTITLE_U = 3.2;

function valueTable(params: readonly Param[], model: ModelSource["model"]): Map<string, ValueInfo> {
  const table = new Map<string, ValueInfo>();
  for (const param of params) {
    table.set(param.id, {
      id: param.id,
      label: param.label,
      unit: param.unit,
      symbol: param.symbol,
      format: DEFAULT_FORMAT,
    });
  }
  for (const constant of model.constants) {
    table.set(constant.id, {
      id: constant.id,
      label: constant.label,
      unit: constant.unit,
      symbol: constant.symbol,
      format: DEFAULT_FORMAT,
    });
  }
  for (const derived of model.derived) {
    table.set(derived.id, {
      id: derived.id,
      label: derived.label,
      unit: derived.unit,
      symbol: derived.symbol,
      format: derived.format ? parseFormat(derived.format) : DEFAULT_FORMAT,
    });
  }
  return table;
}

function Title({ text, frame, theme }: { text: string; frame: Frame; theme: Theme }) {
  const size = (text.length > LONG_TITLE_CHARS ? LONG_TITLE_U : SHORT_TITLE_U) * frame.u;
  return (
    <div
      style={{
        position: "absolute",
        left: frame.title.x,
        top: frame.title.y,
        width: frame.title.width,
        height: frame.title.height,
        display: "flex",
        alignItems: "flex-end",
        fontFamily: fontStacks.display,
        fontVariationSettings: `"opsz" ${SCENE_DISPLAY_OPTICAL_SIZE}`,
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.1,
        color: theme.ink,
      }}
    >
      {text}
    </div>
  );
}

export interface SceneRuntime {
  geometry: Frame;
  slots: Partial<Record<SlotName, Rect>>;
  theme: Theme;
  state: SceneContext["state"];
  contextFor(slot: SlotName): SceneContext | null;
}

export function createSceneRuntime(props: SceneFrameProps): SceneRuntime {
  const { scene, timing, params, model, values, frame, fps, reducedMotion } = props;
  const geometry = createFrame(props.width, props.height);
  const slots = layoutSlots(scene.layout, geometry);
  const source = withSceneValues({ params, model }, scene);
  const definition: ModelDefinition = toModelDefinition(source);
  const info = valueTable(params, source.model);
  const refScope = buildScope(definition, defaultParamValues(definition.params));
  const baseScope = buildScope(definition, values);
  const theme = getTheme(props.theme);
  const computed = computeSceneState({
    scene,
    timing,
    frame,
    baseScope,
    params: values,
    fps,
    reducedMotion,
    disableSweeps: props.disableSweeps,
  });
  const emphasised = new Set(
    scene.elements
      .filter((element) => "role" in element && element.role === "result")
      .map((element) => element.id),
  );
  const state: SceneContext["state"] = {
    ...computed,
    of(target) {
      const found = computed.of(target);
      if (!found.visible || !emphasised.has(splitTarget(target).id)) return found;
      return { ...found, highlight: Math.max(found.highlight, found.progress) };
    },
  };
  const stretch = scene.elements.some((element) => element.type === "axes");
  const base = {
    frame,
    fps,
    u: geometry.u,
    theme,
    language: props.language,
    scope: buildScope(definition, state.paramValues),
    refScope,
    valueInfo: (id: string) => info.get(id),
    state,
    lookup: elementLookup(scene),
    reducedMotion,
  };
  return {
    geometry,
    slots,
    theme,
    state,
    contextFor(slot) {
      const rect = slots[slot];
      if (!rect) return null;
      const size = { width: rect.width, height: rect.height };
      return {
        ...base,
        slot,
        size,
        projection: scene.world ? createProjection(scene.world, size, { stretch }) : null,
      };
    },
  };
}

function SlotView({
  rect,
  elements,
  ctx,
}: {
  rect: Rect;
  elements: readonly SceneElement[];
  ctx: SceneContext;
}) {
  const svg = elements.filter((element) => registry[element.type].kind === "svg");
  const html = elements.filter((element) => registry[element.type].kind === "html");
  const scale = stackScale(html, ctx, HTML_GAP_U * ctx.u);
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      {svg.length > 0 ? (
        <svg
          width={rect.width}
          height={rect.height}
          viewBox={`0 0 ${rect.width} ${rect.height}`}
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
        >
          {svg.map((element) => {
            if (!ctx.state.of(element.id).visible) return null;
            const { Component } = registry[element.type];
            return <Component key={element.id} element={element} ctx={ctx} />;
          })}
        </svg>
      ) : null}
      {html.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: rect.width / scale,
            height: rect.height / scale,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
            display: "flex",
            flexDirection: "column",
            justifyContent: ctx.slot === "formula" || ctx.slot === "text" ? "center" : "flex-start",
            gap: HTML_GAP_U * ctx.u,
          }}
        >
          {html.map((element) => {
            const { Component } = registry[element.type];
            return <Component key={element.id} element={element} ctx={ctx} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SceneFrame(props: SceneFrameProps) {
  const { scene, timing, frame, fps, reducedMotion } = props;
  const runtime = createSceneRuntime(props);
  const { geometry, theme, state } = runtime;
  const entrance = reducedMotion ? 1 : ease("arrive", frame / msToFrames(durationsMs.slow, fps));
  const beat = timing.beats[state.beatIndex];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: entrance,
        transform: `translateX(${(1 - entrance) * sceneMetrics.sceneSlide * geometry.u}px)`,
      }}
    >
      <Title text={scene.title} frame={geometry} theme={theme} />
      {(Object.entries(runtime.slots) as [SlotName, Rect][]).map(([slot, rect]) => {
        const ctx = runtime.contextFor(slot);
        return ctx ? (
          <SlotView
            key={slot}
            rect={rect}
            ctx={ctx}
            elements={scene.elements.filter((element) => element.slot === slot)}
          />
        ) : null;
      })}
      {props.burnSubtitles && beat ? (
        <div
          style={{
            position: "absolute",
            left: geometry.band.x,
            top: geometry.band.y,
            width: geometry.band.width,
            height: geometry.band.height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontFamily: fontStacks.text,
            fontSize: SUBTITLE_U * geometry.u,
            lineHeight: 1.25,
            color: theme.ink,
          }}
        >
          {beat.narration}
        </div>
      ) : null}
    </div>
  );
}
