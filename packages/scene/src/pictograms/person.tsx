import { Line, Solid, type DrawingProps } from "./pen";
import { circle, closed, open, type Pt } from "./shapes";

const torso: Pt[] = [
  [44, 27],
  [56, 27],
  [65, 33],
  [60, 63],
  [40, 63],
  [35, 33],
];

export function Person({ pen }: DrawingProps) {
  return (
    <>
      <Line
        pen={pen}
        d={
          open([35, 34], [28, 62]) +
          open([65, 34], [72, 62]) +
          open([45, 63], [41, 92]) +
          open([55, 63], [59, 92])
        }
      />
      <Solid pen={pen} d={closed(...torso)} />
      <Solid pen={pen} d={circle(50, 14, 10)} />
    </>
  );
}
