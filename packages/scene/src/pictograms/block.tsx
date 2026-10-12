import { hatch, inPolygon } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { closed, open, type Pt } from "./shapes";

const W = 33;
const top: Pt = [50, 12];
const upperRight: Pt = [50 + W, 31];
const lowerRight: Pt = [50 + W, 69];
const bottom: Pt = [50, 88];
const lowerLeft: Pt = [50 - W, 69];
const upperLeft: Pt = [50 - W, 31];
const centre: Pt = [50, 50];

export function Block({ pen }: DrawingProps) {
  const right = [centre, upperRight, lowerRight, bottom];
  return (
    <>
      <Solid pen={pen} d={closed(top, upperRight, lowerRight, bottom, lowerLeft, upperLeft)} />
      <Fine pen={pen} d={hatch(inPolygon(right), hatchGap(pen, 5), 90)} />
      <Line pen={pen} d={open(upperLeft, centre, upperRight) + open(centre, bottom)} />
    </>
  );
}
