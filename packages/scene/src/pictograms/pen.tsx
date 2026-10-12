export interface Pen {
  ink: string;
  paper: string;
  line: number;
  fine: number;
  scale: number;
  coarse: boolean;
}

export interface DrawingProps {
  pen: Pen;
}

const MIN_HATCH_GAP_PX = 3.5;
// stroke weight, in box units, beyond which secondary details only clog the drawing
const COARSE_STROKE_UNITS = 5;

const STROKE = {
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "miter",
  strokeLinecap: "butt",
  strokeMiterlimit: 10,
} as const;

interface PathProps {
  pen: Pen;
  d: string;
}

export function Solid({ pen, d }: PathProps) {
  return <path d={d} fill={pen.paper} stroke={pen.ink} strokeWidth={pen.line} {...STROKE} />;
}

export function Line({ pen, d }: PathProps) {
  return <path d={d} fill="none" stroke={pen.ink} strokeWidth={pen.line} {...STROKE} />;
}

export function Fine({ pen, d }: PathProps) {
  return <path d={d} fill="none" stroke={pen.ink} strokeWidth={pen.fine} {...STROKE} />;
}

export function Backing({ pen, d }: PathProps) {
  return <path d={d} fill={pen.paper} stroke="none" />;
}

export function hatchGap(pen: Pen, nominal: number): number {
  return Math.max(nominal, (MIN_HATCH_GAP_PX * pen.fine) / pen.scale);
}

export function isCoarse(line: number, scale: number): boolean {
  return line / scale > COARSE_STROKE_UNITS;
}
