import { Fine, Line, Solid, type DrawingProps } from "./pen";
import { open } from "./shapes";

export function Leaf({ pen }: DrawingProps) {
  return (
    <g transform="translate(50 50) rotate(40) scale(1.1) translate(-50 -50)">
      <Solid pen={pen} d="M50 84C20 78 22 30 50 6C78 30 80 78 50 84Z" />
      <Line pen={pen} d={open([50, 94], [50, 14])} />
      <Fine
        pen={pen}
        d={
          open([50, 74], [35, 62]) +
          open([50, 74], [65, 62]) +
          open([50, 58], [34, 45]) +
          open([50, 58], [66, 45]) +
          open([50, 42], [37, 31]) +
          open([50, 42], [63, 31])
        }
      />
    </g>
  );
}
