import { Fine, Line, Solid, type DrawingProps } from "./pen";
import { closed, open } from "./shapes";

export function Bulb({ pen }: DrawingProps) {
  return (
    <>
      <Solid pen={pen} d="M40 68C40 60 27 56 24 42A27 27 0 1 1 76 42C73 56 60 60 60 68Z" />
      <Line pen={pen} d="M45 68V46C45 37 55 37 55 46V68" />
      <Solid pen={pen} d={closed([40, 68], [60, 68], [60, 83], [40, 83])} />
      <Solid pen={pen} d={closed([45, 83], [55, 83], [55, 90], [45, 90])} />
      <Fine pen={pen} d={open([40, 74], [60, 74]) + open([40, 79], [60, 79])} />
    </>
  );
}
