import { hatch, inPolygon } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { closed, open, type Pt } from "./shapes";

const weave: Pt[] = [
  [15.7, 49],
  [84.3, 49],
  [76, 88],
  [24, 88],
];

export function Basket({ pen }: DrawingProps) {
  const gap = hatchGap(pen, 11);
  return (
    <>
      <Line pen={pen} d="M22 42C22 2 78 2 78 42" />
      <Fine pen={pen} d="M30 40C30 14 70 14 70 40" />
      <Solid pen={pen} d={closed([14, 40], [86, 40], [76, 88], [24, 88])} />
      <Fine pen={pen} d={hatch(inPolygon(weave), gap, 45) + hatch(inPolygon(weave), gap, -45)} />
      <Line pen={pen} d={open([15.7, 49], [84.3, 49])} />
    </>
  );
}
