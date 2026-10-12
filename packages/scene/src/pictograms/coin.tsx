import { hatch, inCircle, minus, shaded } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { circle, open } from "./shapes";

export function Coin({ pen }: DrawingProps) {
  const rim = minus(shaded(inCircle(50, 50, 38), [50, 50], 9), inCircle(50, 50, 30));
  return (
    <>
      <Solid pen={pen} d={circle(50, 50, 38)} />
      <Fine pen={pen} d={hatch(rim, hatchGap(pen, 3.5))} />
      <Fine pen={pen} d={circle(50, 50, 30)} />
      <Line pen={pen} d={open([43, 40], [52, 31], [52, 69]) + open([43, 69], [61, 69])} />
    </>
  );
}
