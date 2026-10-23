type Vec = readonly [number, number];

export type Side = "a" | "b" | "c";

export interface Box {
  width: number;
  height: number;
}

export type LabelForm = "stacked" | "value" | "row";

export type LabelBoxes = Record<LabelForm, Box>;

export interface RightTriangleInput {
  a: number;
  b: number;
  refA: number;
  refB: number;
  squares: boolean;
  labels: Record<Side, LabelBoxes>;
}

export interface LabelPlacement {
  x: number;
  y: number;
  form: LabelForm;
}

export interface SquareGeometry {
  corners: readonly [Vec, Vec, Vec, Vec];
  side: number;
}

export interface RightTriangleGeometry {
  scale: number;
  lengths: Record<Side, number>;
  corner: Vec;
  apex: Vec;
  foot: Vec;
  markSize: number;
  squares: Record<Side, SquareGeometry> | null;
  labels: Record<Side, LabelPlacement>;
}

interface Arranged {
  geometry: Omit<RightTriangleGeometry, "scale" | "lengths">;
  width: number;
  height: number;
  minX: number;
  minY: number;
}

const MARGIN_U = 3;
const LABEL_GAP_U = 1.4;
const INSIDE_PAD_U = 0.5;
const MARK_U = 1.6;
const MARK_SHARE = 0.3;
const EPSILON = 1e-9;
const SHRINK = 0.995;
const MAX_ROUNDS = 40;

export const SIDES: readonly Side[] = ["a", "b", "c"];

export const cleanLength = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

export function areasOf(a: number, b: number): Record<Side, number> {
  return { a: a * a, b: b * b, c: a * a + b * b };
}

// The squares stand outside the triangle: a to the left, b below, c beyond the hypotenuse.
function extent(a: number, b: number, squares: boolean): Box {
  return squares ? { width: 2 * a + b, height: a + 2 * b } : { width: b, height: a };
}

function fitScale(a: number, b: number, squares: boolean, room: Box): number {
  const { width, height } = extent(a, b, squares);
  return Math.min(room.width / Math.max(width, EPSILON), room.height / Math.max(height, EPSILON));
}

function reach(box: Box, normal: Vec): number {
  return (box.width / 2) * Math.abs(normal[0]) + (box.height / 2) * Math.abs(normal[1]);
}

function fitsInside(box: Box, side: number, normal: Vec, pad: number): boolean {
  const width = box.width + 2 * pad;
  const height = box.height + 2 * pad;
  const along = Math.abs(normal[0]);
  const across = Math.abs(normal[1]);
  return width * along + height * across <= side && width * across + height * along <= side;
}

function arrange(
  sides: Record<Side, number>,
  scale: number,
  u: number,
  input: RightTriangleInput,
  origin: Vec,
): Arranged {
  const { squares, labels: boxes } = input;
  const long = { a: sides.a * scale, b: sides.b * scale, c: sides.c * scale };
  const at = (x: number, y: number): Vec => [origin[0] + x, origin[1] + y];
  const outward: Vec =
    sides.c > 0 ? [sides.a / sides.c, -sides.b / sides.c] : [Math.SQRT1_2, -Math.SQRT1_2];
  const corner = at(0, 0);
  const apex = at(0, -long.a);
  const foot = at(long.b, 0);

  const frames: Record<Side, { middle: Vec; normal: Vec }> = {
    a: { middle: at(0, -long.a / 2), normal: [-1, 0] },
    b: { middle: at(long.b / 2, 0), normal: [0, 1] },
    c: { middle: at(long.b / 2, -long.a / 2), normal: outward },
  };

  const squareOf = (from: Vec, to: Vec, normal: Vec, side: number): SquareGeometry => {
    const dx = normal[0] * side;
    const dy = normal[1] * side;
    return {
      side,
      corners: [from, to, [to[0] + dx, to[1] + dy], [from[0] + dx, from[1] + dy]],
    };
  };
  const built = squares
    ? {
        a: squareOf(corner, apex, frames.a.normal, long.a),
        b: squareOf(foot, corner, frames.b.normal, long.b),
        c: squareOf(apex, foot, frames.c.normal, long.c),
      }
    : null;

  const place = (side: Side): LabelPlacement => {
    const { middle, normal } = frames[side];
    const pad = INSIDE_PAD_U * u;
    const fits = (form: LabelForm) =>
      squares && fitsInside(boxes[side][form], long[side], normal, pad);
    const form: LabelForm = fits("stacked") ? "stacked" : fits("value") ? "value" : "row";
    const depth = squares ? long[side] : 0;
    const distance =
      form === "row" ? depth + LABEL_GAP_U * u + reach(boxes[side].row, normal) : depth / 2;
    return {
      x: middle[0] + normal[0] * distance,
      y: middle[1] + normal[1] * distance,
      form,
    };
  };
  const labels = { a: place("a"), b: place("b"), c: place("c") };

  const points: Vec[] = built
    ? SIDES.flatMap((side) => [...built[side].corners])
    : [corner, apex, foot];
  for (const side of SIDES) {
    const { x, y, form } = labels[side];
    const { width, height } = boxes[side][form];
    points.push([x - width / 2, y - height / 2], [x + width / 2, y + height / 2]);
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);

  return {
    geometry: {
      corner,
      apex,
      foot,
      markSize: Math.min(MARK_U * u, MARK_SHARE * Math.min(long.a, long.b)),
      squares: built,
      labels,
    },
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function rightTriangleLayout(
  slot: Box,
  u: number,
  input: RightTriangleInput,
): RightTriangleGeometry {
  const a = cleanLength(input.a);
  const b = cleanLength(input.b);
  const sides = { a, b, c: Math.hypot(a, b) };
  const room = {
    width: Math.max(0, slot.width - 2 * MARGIN_U * u),
    height: Math.max(0, slot.height - 2 * MARGIN_U * u),
  };
  const refA = cleanLength(input.refA);
  const refB = cleanLength(input.refB);
  const reference =
    refA > 0 && refB > 0 ? fitScale(refA, refB, input.squares, room) : Number.POSITIVE_INFINITY;

  let scale = Math.min(reference, fitScale(a, b, input.squares, room));
  let arranged = arrange(sides, scale, u, input, [0, 0]);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const ratio = Math.min(
      room.width / Math.max(arranged.width, EPSILON),
      room.height / Math.max(arranged.height, EPSILON),
    );
    if (ratio >= 1) break;
    scale *= ratio * SHRINK;
    arranged = arrange(sides, scale, u, input, [0, 0]);
  }

  const origin: Vec = [
    (slot.width - arranged.width) / 2 - arranged.minX,
    (slot.height - arranged.height) / 2 - arranged.minY,
  ];
  return {
    ...arrange(sides, scale, u, input, origin).geometry,
    scale,
    lengths: sides,
  };
}
