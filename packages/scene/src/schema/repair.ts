import { checkModel } from "../expr";
import { WORLD_ELEMENT_TYPES, type Scene } from "./document";
import { elementExtent, elementLookup, type Vec } from "./geometry";
import { splitTarget } from "./inspect";
import { sampleScopes, toModelDefinition, withSceneValues, type ModelSource } from "./model-scope";

const WORLD_MARGIN = 0.08;
const MAX_TARGETS = 6;

function showMissing(scene: Scene): Scene {
  const shown = new Set<string>();
  for (const beat of scene.beats) {
    for (const action of beat.actions) {
      if (action.do === "show")
        for (const target of action.targets) shown.add(splitTarget(target).id);
    }
  }
  const missing = scene.elements.map((element) => element.id).filter((id) => !shown.has(id));
  const first = scene.beats[0];
  if (missing.length === 0 || !first) return scene;
  const actions = [...first.actions];
  for (let i = 0; i < missing.length; i += MAX_TARGETS) {
    actions.push({ do: "show", targets: missing.slice(i, i + MAX_TARGETS), how: "fade" });
  }
  if (actions.length > 6) return scene;
  return { ...scene, beats: [{ ...first, actions }, ...scene.beats.slice(1)] };
}

function fitWorld(scene: Scene, outline: ModelSource): Scene {
  if (!scene.elements.some((element) => WORLD_ELEMENT_TYPES.has(element.type))) return scene;
  const source = withSceneValues(outline, scene);
  if (checkModel(toModelDefinition(source)).length > 0) return scene;

  const lookup = elementLookup(scene);
  const frame = scene.world ?? { x: [-1, 1] as [number, number], y: [-1, 1] as [number, number] };
  const points: Vec[] = [];
  try {
    for (const sample of sampleScopes(source)) {
      for (const element of scene.elements) {
        if (!WORLD_ELEMENT_TYPES.has(element.type) || element.type === "plot") continue;
        points.push(...elementExtent(element, lookup, sample.scope, frame).points);
      }
    }
  } catch {
    return scene;
  }
  const finite = points.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (finite.length === 0) return scene;

  let [x0, x1] = scene.world ? scene.world.x : [Infinity, -Infinity];
  let [y0, y1] = scene.world ? scene.world.y : [Infinity, -Infinity];
  let grew = !scene.world;
  for (const [x, y] of finite) {
    if (x < x0 || x > x1 || y < y0 || y > y1) grew = true;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (!grew) return scene;

  const spanX = Math.max(x1 - x0, 1e-9);
  const spanY = Math.max(y1 - y0, 1e-9);
  const pad = (
    low: number,
    high: number,
    span: number,
    original: readonly [number, number] | undefined,
  ) =>
    [
      original && low >= original[0] ? original[0] : low - span * WORLD_MARGIN,
      original && high <= original[1] ? original[1] : high + span * WORLD_MARGIN,
    ] as [number, number];
  return {
    ...scene,
    world: { x: pad(x0, x1, spanX, scene.world?.x), y: pad(y0, y1, spanY, scene.world?.y) },
  };
}

export function repairScene(scene: Scene, outline: ModelSource): Scene {
  return fitWorld(showMissing(scene), outline);
}
