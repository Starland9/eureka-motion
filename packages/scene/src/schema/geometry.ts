import { compile, resolve, type Bindable, type Scope } from "../expr";
import type { ElementOf, Scene, SceneElement } from "./document";

export type Vec = readonly [number, number];

export function resolvePoint(point: readonly [Bindable, Bindable], scope: Scope): Vec {
  return [resolve(point[0], scope), resolve(point[1], scope)];
}

export function anchorOf(element: SceneElement, scope: Scope): Vec | null {
  switch (element.type) {
    case "point":
    case "object":
      return resolvePoint(element.at, scope);
    case "shape": {
      if (element.kind === "polygon" && element.points) {
        const points = element.points.map((p) => resolvePoint(p, scope));
        const sum = points.reduce<[number, number]>(
          (acc, p) => [acc[0] + p[0], acc[1] + p[1]],
          [0, 0],
        );
        return [sum[0] / points.length, sum[1] / points.length];
      }
      return element.center ? resolvePoint(element.center, scope) : null;
    }
    default:
      return null;
  }
}

export type ElementLookup = ReadonlyMap<string, SceneElement>;

export function elementLookup(scene: Pick<Scene, "elements">): ElementLookup {
  return new Map(scene.elements.map((element) => [element.id, element]));
}

export function resolveAnchor(
  anchor: readonly [Bindable, Bindable] | string,
  lookup: ElementLookup,
  scope: Scope,
): Vec | null {
  if (typeof anchor !== "string") return resolvePoint(anchor, scope);
  const target = lookup.get(anchor);
  return target ? anchorOf(target, scope) : null;
}

export function vectorEnd(
  element: ElementOf<"vector">,
  lookup: ElementLookup,
  scope: Scope,
): Vec | null {
  const start = resolveAnchor(element.from, lookup, scope);
  if (!start) return null;
  if (element.to !== undefined) return resolveAnchor(element.to, lookup, scope);
  if (element.toward === undefined || element.length === undefined) return null;
  const aim = resolveAnchor(element.toward, lookup, scope);
  if (!aim) return null;
  const dx = aim[0] - start[0];
  const dy = aim[1] - start[1];
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return start;
  const length = resolve(element.length, scope);
  return [start[0] + (dx / distance) * length, start[1] + (dy / distance) * length];
}

export function samplePlot(
  fn: string,
  domain: readonly [number, number],
  scope: Scope,
  samples = 48,
): Vec[] {
  const compiled = compile(fn);
  const points: Vec[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = domain[0] + ((domain[1] - domain[0]) * i) / samples;
    points.push([x, compiled.evaluate({ ...scope, x })]);
  }
  return points;
}

export function plotDomain(
  element: ElementOf<"plot">,
  world: { x: readonly [number, number] },
  scope: Scope,
): [number, number] {
  if (!element.domain) return [world.x[0], world.x[1]];
  return [resolve(element.domain[0], scope), resolve(element.domain[1], scope)];
}

export interface Extent {
  points: Vec[];
  label: Vec | null;
  unresolved: boolean;
}

const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export const DIMENSION_OFFSET = -0.12;

export function elementExtent(
  element: SceneElement,
  lookup: ElementLookup,
  scope: Scope,
  world: { x: readonly [number, number]; y: readonly [number, number] },
): Extent {
  const points: Vec[] = [];
  let label: Vec | null = null;
  let unresolved = false;
  const need = (value: Vec | null): Vec | null => {
    if (value === null) unresolved = true;
    else points.push(value);
    return value;
  };

  switch (element.type) {
    case "point":
      label = need(resolvePoint(element.at, scope));
      break;
    case "object": {
      const at = resolvePoint(element.at, scope);
      const half = Math.abs(resolve(element.size, scope)) / 2;
      points.push([at[0] - half, at[1] - half], [at[0] + half, at[1] + half]);
      label = [at[0], at[1] - half];
      break;
    }
    case "segment": {
      const a = need(resolveAnchor(element.from, lookup, scope));
      const b = need(resolveAnchor(element.to, lookup, scope));
      if (a && b) label = mid(a, b);
      break;
    }
    case "dimension": {
      const a = need(resolveAnchor(element.from, lookup, scope));
      const b = need(resolveAnchor(element.to, lookup, scope));
      const offset = element.offset ?? DIMENSION_OFFSET * (world.y[1] - world.y[0]);
      if (a && b) {
        const m = mid(a, b);
        label = [m[0], m[1] + offset];
      }
      break;
    }
    case "vector": {
      need(resolveAnchor(element.from, lookup, scope));
      label = need(vectorEnd(element, lookup, scope));
      break;
    }
    case "angle": {
      label = need(resolveAnchor(element.vertex, lookup, scope));
      if (resolveAnchor(element.from, lookup, scope) === null) unresolved = true;
      if (resolveAnchor(element.to, lookup, scope) === null) unresolved = true;
      break;
    }
    case "shape": {
      if (element.kind === "polygon" && element.points) {
        for (const p of element.points) points.push(resolvePoint(p, scope));
      } else if (element.center) {
        const c = resolvePoint(element.center, scope);
        const rx =
          element.kind === "rect"
            ? Math.abs(resolve(element.width ?? 0, scope)) / 2
            : Math.abs(resolve(element.radius ?? 0, scope));
        const ry = element.kind === "rect" ? Math.abs(resolve(element.height ?? 0, scope)) / 2 : rx;
        points.push([c[0] - rx, c[1] - ry], [c[0] + rx, c[1] + ry]);
      }
      label = anchorOf(element, scope);
      break;
    }
    case "area":
      points.push(
        [resolve(element.from, scope), world.y[0]],
        [resolve(element.to, scope), world.y[0]],
      );
      break;
    case "tangent":
      points.push([resolve(element.at, scope), world.y[0]]);
      break;
    default:
      break;
  }
  if (!("label" in element) || !element.label) label = null;
  return { points, label, unresolved };
}
