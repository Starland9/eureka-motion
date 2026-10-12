import { hatch, inPolygon } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { closed, open, type Pt } from "./shapes";

const LIQUID = 62;
const liquid: Pt[] = [
  [30, LIQUID],
  [72, LIQUID],
  [72, 88],
  [30, 88],
];

export function Beaker({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d={closed([20, 12], [30, 18], [30, 88], [72, 88], [72, 12])} />
      <Fine pen={pen} d={hatch(inPolygon(liquid), hatchGap(pen, 6), 45)} />
      <Line pen={pen} d={open([30, LIQUID], [72, LIQUID])} />
      {pen.coarse ? null : (
        <Fine
          pen={pen}
          d={
            open([30, 18], [72, 18]) +
            open([60, 28], [72, 28]) +
            open([66, 40], [72, 40]) +
            open([60, 52], [72, 52])
          }
        />
      )}
    </>
  );
}
