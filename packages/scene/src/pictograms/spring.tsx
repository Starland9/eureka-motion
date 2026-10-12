import { Backing, Line, type DrawingProps } from "./pen";
import { closed, open } from "./shapes";

export function Spring({ pen }: DrawingProps) {
  return (
    <>
      <Backing pen={pen} d={closed([22, 26], [78, 26], [78, 74], [22, 74])} />
      <Line
        pen={pen}
        d={
          open(
            [12, 50],
            [22, 50],
            [29.5, 26],
            [39.75, 74],
            [50, 26],
            [60.25, 74],
            [70.5, 26],
            [78, 50],
            [88, 50],
          ) +
          open([12, 18], [12, 82]) +
          open([88, 18], [88, 82])
        }
      />
    </>
  );
}
