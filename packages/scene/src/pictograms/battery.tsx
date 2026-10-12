import { hatch, inPolygon } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { closed, open } from "./shapes";

export function Battery({ pen }: DrawingProps) {
  return (
    <>
      <Solid
        pen={pen}
        d={closed([30, 26], [42, 26], [42, 12], [58, 12], [58, 26], [70, 26], [70, 90], [30, 90])}
      />
      <Fine
        pen={pen}
        d={hatch(
          inPolygon([
            [61, 26],
            [70, 26],
            [70, 90],
            [61, 90],
          ]),
          hatchGap(pen, 3.5),
          90,
        )}
      />
      <Line
        pen={pen}
        d={open([41, 44], [55, 44]) + open([48, 37], [48, 51]) + open([41, 72], [55, 72])}
      />
    </>
  );
}
