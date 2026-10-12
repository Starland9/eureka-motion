import { render, type RenderResult } from "@testing-library/react";
import { createSceneRuntime, type SceneFrameProps } from "../../src/composition/SceneFrame";
import type { SceneContext } from "../../src/composition/context";
import { registry } from "../../src/composition/registry";
import { buildTimeline } from "../../src/composition/timeline";
import type { Language } from "../../src/expr";
import type {
  LayoutName,
  Model,
  Param,
  Scene,
  SceneElement,
  SlotName,
} from "../../src/schema/document";
import { CANVAS, type ThemeName } from "../../src/tokens";

export interface SceneOptions {
  layout?: LayoutName;
  world?: Scene["world"];
  beats?: Scene["beats"];
  title?: string;
}

export function sceneOf(elements: SceneElement[], options: SceneOptions = {}): Scene {
  return {
    id: "s1",
    index: 0,
    role: "mechanism",
    title: options.title ?? "Test",
    layout: options.layout ?? "figure",
    world: options.world,
    elements,
    beats: options.beats ?? [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: elements.map((element) => element.id), how: "fade", at: 0 },
        ],
      },
    ],
  };
}

export interface ContextOptions {
  scene: Scene;
  slot?: SlotName;
  frame?: number | "end";
  params?: Param[];
  model?: Model;
  values?: Record<string, number>;
  theme?: ThemeName;
  language?: Language;
  width?: number;
  reducedMotion?: boolean;
}

export function frameProps(options: ContextOptions): SceneFrameProps {
  const timing = buildTimeline([options.scene]).scenes[0]!;
  const width = options.width ?? CANVAS.width;
  return {
    scene: options.scene,
    timing,
    params: options.params ?? [],
    model: options.model ?? { constants: [], derived: [] },
    language: options.language ?? "fr",
    theme: options.theme ?? "paper",
    values: options.values ?? {},
    reducedMotion: options.reducedMotion ?? false,
    disableSweeps: false,
    burnSubtitles: false,
    frame:
      options.frame === undefined || options.frame === "end" ? timing.duration - 1 : options.frame,
    width,
    height: (width * CANVAS.height) / CANVAS.width,
    fps: 30,
  };
}

export function testContext(options: ContextOptions): SceneContext {
  const slot = options.slot ?? options.scene.elements[0]!.slot;
  const ctx = createSceneRuntime(frameProps(options)).contextFor(slot);
  if (!ctx) throw new Error(`layout "${options.scene.layout}" has no slot "${slot}"`);
  return ctx;
}

export function renderElement(element: SceneElement, ctx: SceneContext): RenderResult {
  const { kind, Component } = registry[element.type];
  return kind === "svg"
    ? render(
        <svg width={ctx.size.width} height={ctx.size.height}>
          <Component element={element} ctx={ctx} />
        </svg>,
      )
    : render(<Component element={element} ctx={ctx} />);
}
