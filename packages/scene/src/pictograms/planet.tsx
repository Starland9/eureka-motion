import { hatch, inCircle, shaded } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { arc, circle } from "./shapes";

const R = 38;
const TILT = (30 * Math.PI) / 180;

function latitude(degrees: number): string {
  const phi = (degrees * Math.PI) / 180;
  const a = R * Math.cos(phi);
  const y = 50 - R * Math.sin(phi) * Math.cos(TILT);
  return arc([50 - a, y], [50 + a, y], a, a * Math.sin(TILT), 0);
}

export function Planet({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d={circle(50, 50, R)} />
      <Fine pen={pen} d={hatch(shaded(inCircle(50, 50, R), [50, 50], 11), hatchGap(pen, 4))} />
      <Line pen={pen} d={latitude(26) + latitude(-18)} />
    </>
  );
}
