import { hatch, inPolygon, shaded } from "./hatch";
import { Fine, hatchGap, Line, Solid, type DrawingProps } from "./pen";
import { cubics, open } from "./shapes";

const body = cubics(
  [50, 34],
  [
    [57, 25],
    [74, 24],
    [83, 36],
  ],
  [
    [91, 48],
    [87, 70],
    [75, 82],
  ],
  [
    [68, 90],
    [58, 90],
    [50, 86],
  ],
  [
    [42, 90],
    [32, 90],
    [25, 82],
  ],
  [
    [13, 70],
    [9, 48],
    [17, 36],
  ],
  [
    [26, 24],
    [43, 25],
    [50, 34],
  ],
);

const leaf = cubics(
  [53, 21],
  [
    [55.2, 10.4],
    [69.6, 11],
    [80, 10],
  ],
  [
    [71.9, 16.5],
    [61.9, 27.1],
    [53, 21],
  ],
);

const SHADING_CACHE_LIMIT = 16;
const shadingByGap = new Map<number, string>();

// Sampling the hatching costs about 20 ms and depends on the gap alone.
function shading(gap: number): string {
  let d = shadingByGap.get(gap);
  if (d === undefined) {
    d = hatch(shaded(inPolygon(body.polygon), [50, 50], 9), gap);
    if (shadingByGap.size >= SHADING_CACHE_LIMIT) shadingByGap.clear();
    shadingByGap.set(gap, d);
  }
  return d;
}

export function Apple({ pen }: DrawingProps) {
  return (
    <>
      <Line pen={pen} d={open([50, 34], [52, 14])} />
      <Solid pen={pen} d={leaf.d} />
      <Fine pen={pen} d={open([53, 21], [80, 10])} />
      <Solid pen={pen} d={body.d} />
      <Fine pen={pen} d={shading(hatchGap(pen, 4))} />
    </>
  );
}
