import { Fine, Solid, type DrawingProps } from "./pen";
import { circle, ellipse, open } from "./shapes";

function Organelle({
  pen,
  x,
  y,
  rotation,
}: DrawingProps & { x: number; y: number; rotation: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
      <Solid pen={pen} d={ellipse(0, 0, 10.5, 6)} />
      {pen.coarse ? null : (
        <Fine pen={pen} d={open([-6, 0], [-3, -2.5], [0, 2.5], [3, -2.5], [6, 0])} />
      )}
    </g>
  );
}

export function Cell({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d={ellipse(50, 50, 43, 31, -10)} />
      {pen.coarse ? null : <Fine pen={pen} d={ellipse(50, 50, 39, 27, -10)} />}
      <Solid pen={pen} d={circle(40, 50, 13)} />
      {pen.coarse ? null : <Fine pen={pen} d={circle(37, 47, 4)} />}
      <Organelle pen={pen} x={69} y={38} rotation={-30} />
      <Organelle pen={pen} x={66} y={64} rotation={22} />
    </>
  );
}
