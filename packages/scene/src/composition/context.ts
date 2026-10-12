import type { Language, NumberFormat, Scope } from "../expr";
import type { Projection } from "../layouts";
import type { ElementOf, ElementType, SlotName } from "../schema/document";
import type { ElementLookup } from "../schema/geometry";
import type { Theme } from "../tokens";
import type { SceneState } from "./state";

export interface ValueInfo {
  id: string;
  label: string;
  unit: string;
  symbol: string | undefined;
  format: NumberFormat;
}

export interface SceneContext {
  frame: number;
  fps: number;
  u: number;
  theme: Theme;
  language: Language;
  scope: Scope;
  refScope: Scope;
  valueInfo(id: string): ValueInfo | undefined;
  state: SceneState;
  slot: SlotName;
  size: { width: number; height: number };
  projection: Projection | null;
  lookup: ElementLookup;
  reducedMotion: boolean;
}

export interface PrimitiveProps<T extends ElementType = ElementType> {
  element: ElementOf<T>;
  ctx: SceneContext;
}
