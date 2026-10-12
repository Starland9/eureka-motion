import { Line, Solid, type DrawingProps } from "./pen";
import { closed, open } from "./shapes";

export function Resistor({ pen }: DrawingProps) {
  return (
    <>
      <Line pen={pen} d={open([5, 50], [22, 50]) + open([78, 50], [95, 50])} />
      <Solid pen={pen} d={closed([22, 37], [78, 37], [78, 63], [22, 63])} />
    </>
  );
}
