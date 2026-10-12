import { hatch, inCircle, shaded } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { circle, open, type Pt } from "./shapes";

const oxygen: Pt = [50, 40];
const left: Pt = [17.8, 67];
const right: Pt = [82.2, 67];

function Atom({ pen, at, r }: DrawingProps & { at: Pt; r: number }) {
  return (
    <>
      <Solid pen={pen} d={circle(at[0], at[1], r)} />
      {pen.coarse ? null : (
        <Fine
          pen={pen}
          d={hatch(shaded(inCircle(at[0], at[1], r), at, r / 2.5), hatchGap(pen, 4), undefined, 3)}
        />
      )}
    </>
  );
}

export function Molecule({ pen }: DrawingProps) {
  return (
    <>
      <Line pen={pen} d={open(left, oxygen, right)} />
      <Atom pen={pen} at={oxygen} r={17} />
      <Atom pen={pen} at={left} r={12} />
      <Atom pen={pen} at={right} r={12} />
    </>
  );
}
