import { resolve, type Scope } from "../expr";
import { resolveAnchor, resolvePoint, vectorEnd, type ElementLookup } from "./geometry";

export const OBJECT_REACH = 0.58;
export const OBJECT_LABEL_GAP_U = 3.2;
const ADVANCE_EM = 0.6;
const PAD_EM = 0.3;
const HEIGHT_EM = 1.2;

export type LabelSide = 1 | -1;

export interface ObjectLabelInput {
  lookup: ElementLookup;
  scope: Scope;
  slot: string;
  toPx(point: readonly [number, number]): [number, number];
  length(worldLength: number): number;
  u: number;
  labelSize: number;
}

// A label under the pictogram would sit on a vector that leaves it downwards.
function hasVectorBelow(id: string, lookup: ElementLookup, scope: Scope): boolean {
  for (const other of lookup.values()) {
    if (other.type !== "vector" || other.from !== id) continue;
    const start = resolveAnchor(other.from, lookup, scope);
    const end = vectorEnd(other, lookup, scope);
    if (!start || !end) continue;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    if (dy < 0 && Math.abs(dx) < Math.abs(dy)) return true;
  }
  return false;
}

export function objectLabelOffset(side: LabelSide, sizePx: number, u: number): number {
  return side * (OBJECT_REACH * sizePx + OBJECT_LABEL_GAP_U * u);
}

// Side of its pictogram on which each labelled object of a slot writes its label: below,
// unless a vector leaves it downwards or the label would run into the next one, in which
// case the earlier of the two goes above.
export function objectLabelSides(input: ObjectLabelInput): Map<string, LabelSide> {
  const placed: { id: string; x: number; y: number; size: number; width: number }[] = [];
  const sides = new Map<string, LabelSide>();
  for (const element of input.lookup.values()) {
    if (element.type !== "object" || element.slot !== input.slot || !element.label) continue;
    const [x, y] = input.toPx(resolvePoint(element.at, input.scope));
    placed.push({
      id: element.id,
      x,
      y,
      size: input.length(Math.abs(resolve(element.size, input.scope))),
      width: element.label.length * ADVANCE_EM * input.labelSize,
    });
    sides.set(element.id, hasVectorBelow(element.id, input.lookup, input.scope) ? -1 : 1);
  }
  const labelY = (item: (typeof placed)[number]): number =>
    item.y + objectLabelOffset(sides.get(item.id) ?? 1, item.size, input.u);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i] as (typeof placed)[number];
      const b = placed[j] as (typeof placed)[number];
      if (sides.get(a.id) !== 1 || sides.get(b.id) !== 1) continue;
      const reach = (a.width + b.width) / 2 + PAD_EM * input.labelSize;
      if (
        Math.abs(a.x - b.x) < reach &&
        Math.abs(labelY(a) - labelY(b)) < HEIGHT_EM * input.labelSize
      ) {
        sides.set(a.id, -1);
      }
    }
  }
  return sides;
}
