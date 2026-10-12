import type { ComponentType } from "react";
import type { SceneContext } from "../composition/context";
import type { PICTOGRAMS } from "../schema/document";
import { strokeWidth } from "../primitives/shared/style";
import { Apple } from "./apple";
import { Ball } from "./ball";
import { Basket } from "./basket";
import { Battery } from "./battery";
import { Beaker } from "./beaker";
import { Block } from "./block";
import { Bulb } from "./bulb";
import { Cell } from "./cell";
import { Coin } from "./coin";
import { Leaf } from "./leaf";
import { Molecule } from "./molecule";
import { Moon } from "./moon";
import { isCoarse, type DrawingProps, type Pen } from "./pen";
import { Person } from "./person";
import { Planet } from "./planet";
import { Resistor } from "./resistor";
import { Spring } from "./spring";
import { Sun } from "./sun";

export type PictogramKind = (typeof PICTOGRAMS)[number];

export interface PictogramProps {
  ctx: SceneContext;
  kind: PictogramKind;
  x: number;
  y: number;
  size: number;
  colour?: string;
  opacity?: number;
}

const BOX = 100;

const drawings: Readonly<Record<PictogramKind, ComponentType<DrawingProps>>> = {
  planet: Planet,
  moon: Moon,
  sun: Sun,
  apple: Apple,
  ball: Ball,
  block: Block,
  spring: Spring,
  person: Person,
  battery: Battery,
  bulb: Bulb,
  resistor: Resistor,
  beaker: Beaker,
  molecule: Molecule,
  cell: Cell,
  leaf: Leaf,
  coin: Coin,
  basket: Basket,
};

export function Pictogram({ ctx, kind, x, y, size, colour, opacity = 1 }: PictogramProps) {
  const Drawing = drawings[kind];
  const line = strokeWidth(ctx, "regular");
  const scale = size / BOX;
  const pen: Pen = {
    ink: colour ?? ctx.theme.ink,
    paper: ctx.theme.surfaceRaised,
    line,
    fine: strokeWidth(ctx, "construction"),
    scale,
    coarse: isCoarse(line, scale),
  };
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${scale})`} opacity={opacity}>
      <Drawing pen={pen} />
    </g>
  );
}
