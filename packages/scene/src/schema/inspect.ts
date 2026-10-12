import { isBound } from "../expr";
import {
  ELEMENT_PARTS,
  ROLE_COLOURS,
  type ElementType,
  type Scene,
  type SceneElement,
} from "./document";

export interface Binding {
  path: string;
  expr: string;
  allowX: boolean;
  allowTime: boolean;
}

function collectBound(value: unknown, path: string, into: Binding[]): void {
  if (isBound(value)) {
    into.push({ path, expr: value.expr, allowX: false, allowTime: false });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectBound(item, `${path}[${i}]`, into));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collectBound(child, path ? `${path}.${key}` : key, into);
    }
  }
}

export function elementBindings(element: SceneElement): Binding[] {
  const found: Binding[] = [];
  collectBound(element, "", found);
  if (element.type === "plot") {
    found.push({ path: "fn", expr: element.fn, allowX: true, allowTime: true });
  }
  return found;
}

export interface TextRef {
  path: string;
  text: string;
  isTex: boolean;
}

export function elementTexts(element: SceneElement): TextRef[] {
  switch (element.type) {
    case "text":
      return [{ path: "text", text: element.text, isTex: false }];
    case "list":
      return element.items.map((text, i) => ({ path: `items[${i}]`, text, isTex: false }));
    case "formula":
      return [{ path: "tex", text: element.tex, isTex: true }];
    default:
      return [];
  }
}

export interface AnchorRef {
  path: string;
  ref: string;
}

export function elementAnchors(element: SceneElement): AnchorRef[] {
  const refs: AnchorRef[] = [];
  const add = (path: string, value: unknown): void => {
    if (typeof value === "string") refs.push({ path, ref: value });
  };
  switch (element.type) {
    case "segment":
    case "dimension":
      add("from", element.from);
      add("to", element.to);
      break;
    case "vector":
      add("from", element.from);
      add("to", element.to);
      add("toward", element.toward);
      break;
    case "angle":
      add("vertex", element.vertex);
      add("from", element.from);
      add("to", element.to);
      break;
    default:
      break;
  }
  return refs;
}

export const ANCHORABLE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  "point",
  "object",
  "shape",
]);

type RoleColour = (typeof ROLE_COLOURS)[number];
const isRole = (value: unknown): value is RoleColour =>
  typeof value === "string" && (ROLE_COLOURS as readonly string[]).includes(value);

const SIM_ROLES: Partial<Record<ElementType, readonly RoleColour[]>> = {
  "sim.two-body": ["quantity", "action"],
  "sim.fall": ["quantity", "action"],
  "sim.orbit": ["quantity", "action"],
  "sim.pendulum": ["quantity"],
  "sim.circuit": ["quantity", "action"],
  "sim.wave": ["quantity"],
  "sim.right-triangle": ["quantity", "result"],
  "sim.reaction": ["quantity", "valid"],
  "sim.array": ["quantity", "action", "valid"],
  "sim.market": ["quantity", "action", "result"],
};

function collectRoles(value: unknown, into: Set<RoleColour>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRoles(item, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "role" || key === "fill") && isRole(child)) into.add(child);
      else collectRoles(child, into);
    }
  }
}

export function elementRoles(element: SceneElement): Set<RoleColour> {
  const found = new Set<RoleColour>(SIM_ROLES[element.type] ?? []);
  collectRoles(element, found);
  if (element.type === "formula") {
    if (element.tex.includes("\\q{")) found.add("quantity");
    if (element.tex.includes("\\a{")) found.add("action");
    if (element.tex.includes("\\res{")) found.add("result");
    if (element.tex.includes("\\ok{")) found.add("valid");
  }
  return found;
}

const SIM_LABELS: Partial<Record<ElementType, number>> = {
  "sim.two-body": 4,
  "sim.fall": 2,
  "sim.orbit": 2,
  "sim.pendulum": 2,
  "sim.circuit": 3,
  "sim.wave": 2,
  "sim.right-triangle": 3,
  "sim.reaction": 2,
  "sim.array": 2,
  "sim.market": 4,
};

export function elementLabelCount(element: SceneElement): number {
  switch (element.type) {
    case "axes":
      return (element.xLabel ? 1 : 0) + (element.yLabel ? 1 : 0);
    case "bars":
      return element.items.length;
    case "sim.flow":
      return 1 + element.inputs.length + element.outputs.length;
    case "text":
    case "list":
    case "formula":
    case "readout":
    case "timeline":
    case "steps":
    case "relations":
    case "table":
      return 0;
    default: {
      const fixed = SIM_LABELS[element.type];
      if (fixed !== undefined) return fixed;
      return "label" in element && element.label ? 1 : 0;
    }
  }
}

export function elementParts(element: SceneElement): readonly string[] {
  switch (element.type) {
    case "timeline":
      return element.events.map((_, i) => `e${i + 1}`);
    case "steps":
      return element.items.map((_, i) => `s${i + 1}`);
    case "relations":
      return element.nodes.map((node) => node.id);
    case "sim.flow":
      return ["node", ...element.inputs.map((b) => b.id), ...element.outputs.map((b) => b.id)];
    default:
      return ELEMENT_PARTS[element.type] ?? [];
  }
}

export function splitTarget(target: string): { id: string; part: string | undefined } {
  const dot = target.indexOf(".");
  return dot === -1
    ? { id: target, part: undefined }
    : { id: target.slice(0, dot), part: target.slice(dot + 1) };
}

export function visibilityByBeat(
  scene: Pick<Scene, "elements" | "beats">,
): Map<string, Set<number>> {
  const visible = new Map<string, Set<number>>();
  for (const element of scene.elements) visible.set(element.id, new Set());
  const shown = new Set<string>();
  scene.beats.forEach((beat, index) => {
    const hiddenThisBeat: string[] = [];
    for (const action of beat.actions) {
      if (action.do === "show") {
        for (const target of action.targets) shown.add(splitTarget(target).id);
      } else if (action.do === "hide") {
        for (const target of action.targets) {
          const { id, part } = splitTarget(target);
          if (part === undefined) hiddenThisBeat.push(id);
        }
      }
    }
    for (const id of shown) visible.get(id)?.add(index);
    for (const id of hiddenThisBeat) shown.delete(id);
  });
  return visible;
}
