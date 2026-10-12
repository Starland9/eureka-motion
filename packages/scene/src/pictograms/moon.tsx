import { hatch, inCircle, shaded } from "./hatch";
import { Fine, hatchGap, Solid, type DrawingProps } from "./pen";
import { circle } from "./shapes";

const R = 33;

export function Moon({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d={circle(50, 50, R)} />
      <Fine pen={pen} d={hatch(shaded(inCircle(50, 50, R), [50, 50], 7), hatchGap(pen, 4))} />
      <Fine pen={pen} d={circle(38, 40, 8) + circle(62, 44, 5.5) + circle(50, 68, 9)} />
    </>
  );
}
