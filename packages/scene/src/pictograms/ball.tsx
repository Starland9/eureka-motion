import { hatch, inCircle, shaded } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { circle } from "./shapes";

const R = 38;

export function Ball({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d={circle(50, 50, R)} />
      <Fine pen={pen} d={hatch(shaded(inCircle(50, 50, R), [50, 50], 10), hatchGap(pen, 4))} />
      <Line pen={pen} d="M12.7 57C28 28 46 44 50 50C54 56 72 72 87.3 43" />
    </>
  );
}
