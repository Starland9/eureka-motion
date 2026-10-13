import { checkModel } from "../expr";
import { WORLD_ELEMENT_TYPES, type Scene } from "./document";
import { elementExtent, elementLookup, type Vec } from "./geometry";
import { elementParts, splitTarget } from "./inspect";
import { collidingLabels } from "./labels";
import { sampleScopes, toModelDefinition, withSceneValues, type ModelSource } from "./model-scope";

const WORLD_MARGIN = 0.08;
const MAX_TARGETS = 6;
const MAX_LABEL_DROPS = 4;

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

// An arrow given only a target is drawn all the way to it.
function completeVectors(scene: Scene): Scene {
  let changed = false;
  const elements = scene.elements.map((element) => {
    if (element.type !== "vector") return element;
    if (element.to !== undefined || element.toward === undefined || element.length !== undefined)
      return element;
    changed = true;
    const { toward, ...rest } = element;
    return { ...rest, to: toward };
  });
  return changed ? { ...scene, elements } : scene;
}

// A target that names a part the element does not have falls back to the element.
function knownTargets(scene: Scene): Scene {
  const parts = new Map(scene.elements.map((element) => [element.id, elementParts(element)]));
  const fix = (target: string): string => {
    const { id, part } = splitTarget(target);
    const known = parts.get(id);
    return part !== undefined && known && !known.includes(part) ? id : target;
  };
  let changed = false;
  const beats = scene.beats.map((beat) => ({
    ...beat,
    actions: beat.actions.map((action) => {
      if ("targets" in action) {
        const targets = [...new Set(action.targets.map(fix))];
        if (targets.join("|") === action.targets.join("|")) return action;
        changed = true;
        return { ...action, targets };
      }
      if ("target" in action && typeof action.target === "string") {
        const target = fix(action.target);
        if (target === action.target) return action;
        changed = true;
        return { ...action, target };
      }
      return action;
    }),
  }));
  return changed ? { ...scene, beats } : scene;
}

// Two labels on the same spot: the later one goes, rather than asking for the scene again.
function dropCollidingLabels(scene: Scene, outline: ModelSource): Scene {
  const source = withSceneValues(outline, scene);
  if (checkModel(toModelDefinition(source)).length > 0) return scene;
  let current = scene;
  for (let pass = 0; pass < MAX_LABEL_DROPS; pass += 1) {
    let drop: string | undefined;
    try {
      const scope = sampleScopes(source)[0]?.scope;
      if (!scope) return current;
      for (const [a, b] of collidingLabels(current, scope)) {
        drop = [b, a].find((element) => "label" in element && element.label !== undefined)?.id;
        if (drop) break;
      }
    } catch {
      return current;
    }
    if (!drop) return current;
    const id = drop;
    current = {
      ...current,
      elements: current.elements.map((element) => {
        if (element.id !== id || !("label" in element)) return element;
        const copy = { ...element };
        delete copy.label;
        return copy;
      }),
    };
  }
  return current;
}

export function repairScene(scene: Scene, outline: ModelSource): Scene {
  const repaired = fitWorld(showMissing(knownTargets(completeVectors(scene))), outline);
  return dropCollidingLabels(repaired, outline);
}
