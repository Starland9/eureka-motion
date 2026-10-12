import { Line, Solid, type DrawingProps } from "./pen";
import { circle, open, type Pt } from "./shapes";

const RAYS = 8;
const INNER = 29;

function ray(index: number): string {
  const angle = (index * 2 * Math.PI) / RAYS;
  const outer = index % 2 === 0 ? 45 : 40;
  const point = (r: number): Pt => [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)];
  return open(point(INNER), point(outer));
}

export function Sun({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d={circle(50, 50, 19)} />
      <Line pen={pen} d={Array.from({ length: RAYS }, (_, i) => ray(i)).join("")} />
    </>
  );
}
