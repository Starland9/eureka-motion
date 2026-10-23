type Vec = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LoopGeometry {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  length: number;
}

export interface ComponentGeometry {
  x: number;
  y: number;
  size: number;
  label: Vec;
  body: Rect;
  band: Rect;
}

export interface ArrowGeometry {
  from: Vec;
  tip: Vec;
  length: number;
  label: Vec;
  band: Rect;
}

export interface FlowGeometry {
  count: number;
  spacing: number;
  rate: number;
  speed: number;
}

export interface CircuitGeometry {
  loop: LoopGeometry;
  wireBands: Rect[];
  battery: ComponentGeometry;
  resistor: ComponentGeometry;
  arrow: ArrowGeometry;
  flow: FlowGeometry;
}

// Extents of the battery and resistor drawings, as fractions of the pictogram size.
const BATTERY = { halfWidth: 0.2, top: 0.38, bottom: 0.4 } as const;
const RESISTOR = { halfWidth: 0.28, halfHeight: 0.13 } as const;

const LOOP_WIDTH_RATIO = 0.56;
const LOOP_ASPECT = 1.6;
const MARGIN_U = 4;
const TOP_ROOM_U = 9;
const BOTTOM_ROOM_U = 3;
const MIN_LOOP_HEIGHT_U = 8;
const BATTERY_HEIGHT_RATIO = 0.45;
const BATTERY_MAX_HEIGHT_U = 10;
const RESISTOR_SIZE_RATIO = 0.3;
const LABEL_GAP_U = 1.5;
const RESISTOR_LABEL_DROP_U = 2.8;
const ARROW_RISE_U = 3;
const ARROW_INSET_U = 3;
const ARROW_LABEL_RISE_U = 3.2;
const ARROW_REFERENCE_RATIO = 0.2;
const BAND_PAD_U = 0.5;
const BAND_HALF_U = 1;

const CARRIER_SPACING_U = 5;
// Carriers crossing any section of the wire each second at the default values.
export const REFERENCE_RATE = 1.5;
// Beyond this the dots move more than a third of their spacing per frame and read as a blur.
export const MAX_FLOW_RATIO = 6;

export function circuitLayout(
  slot: { width: number; height: number },
  u: number,
  currentRatio: number,
): CircuitGeometry {
  const { width, height } = slot;
  const ratio = Math.min(Math.max(0, currentRatio), MAX_FLOW_RATIO);

  const loopWidth = Math.min(LOOP_WIDTH_RATIO * width, width - 2 * MARGIN_U * u);
  const topRoom = TOP_ROOM_U * u;
  const room = height - topRoom - BOTTOM_ROOM_U * u;
  const loopHeight = Math.max(MIN_LOOP_HEIGHT_U * u, Math.min(loopWidth / LOOP_ASPECT, room));
  const x0 = (width - loopWidth) / 2;
  const y0 = topRoom + Math.max(0, (room - loopHeight) / 2);
  const x1 = x0 + loopWidth;
  const y1 = y0 + loopHeight;
  const loop: LoopGeometry = {
    x0,
    y0,
    x1,
    y1,
    width: loopWidth,
    height: loopHeight,
    length: 2 * (loopWidth + loopHeight),
  };

  const pad = BAND_PAD_U * u;
  const half = BAND_HALF_U * u;
  const grown = (rect: Rect, by: number): Rect => ({
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  });

  const batterySize =
    Math.min(BATTERY_HEIGHT_RATIO * loopHeight, BATTERY_MAX_HEIGHT_U * u) /
    (BATTERY.top + BATTERY.bottom);
  const batteryY = (y0 + y1) / 2;
  const batteryBody: Rect = {
    x: x0 - BATTERY.halfWidth * batterySize,
    y: batteryY - BATTERY.top * batterySize,
    width: 2 * BATTERY.halfWidth * batterySize,
    height: (BATTERY.top + BATTERY.bottom) * batterySize,
  };
  const battery: ComponentGeometry = {
    x: x0,
    y: batteryY,
    size: batterySize,
    label: [x0 + BATTERY.halfWidth * batterySize + LABEL_GAP_U * u, batteryY],
    body: batteryBody,
    band: grown(batteryBody, pad),
  };

  const resistorSize = RESISTOR_SIZE_RATIO * loopWidth;
  const resistorX = (x0 + x1) / 2;
  const resistorBody: Rect = {
    x: resistorX - RESISTOR.halfWidth * resistorSize,
    y: y0 - RESISTOR.halfHeight * resistorSize,
    width: 2 * RESISTOR.halfWidth * resistorSize,
    height: 2 * RESISTOR.halfHeight * resistorSize,
  };
  const resistor: ComponentGeometry = {
    x: resistorX,
    y: y0,
    size: resistorSize,
    label: [resistorX, y0 + RESISTOR.halfHeight * resistorSize + RESISTOR_LABEL_DROP_U * u],
    body: resistorBody,
    band: grown(resistorBody, pad),
  };

  const arrowY = y0 - ARROW_RISE_U * u;
  const arrowFrom = x0 + ARROW_INSET_U * u;
  const arrowLength = Math.min(
    ARROW_REFERENCE_RATIO * loopWidth * ratio,
    Math.max(0, loopWidth - 2 * ARROW_INSET_U * u),
  );
  const arrowLabelY = arrowY - ARROW_LABEL_RISE_U * u;
  const arrow: ArrowGeometry = {
    from: [arrowFrom, arrowY],
    tip: [arrowFrom + arrowLength, arrowY],
    length: arrowLength,
    label: [arrowFrom + arrowLength / 2, arrowLabelY],
    band: { x: arrowFrom - pad, y: arrowY - half, width: arrowLength + 2 * pad, height: 2 * half },
  };

  const count = Math.max(1, Math.floor(loop.length / (CARRIER_SPACING_U * u)));
  const spacing = loop.length / count;
  const rate = REFERENCE_RATE * ratio;

  return {
    loop,
    wireBands: [
      { x: x0 - pad, y: y0 - half, width: loopWidth + 2 * pad, height: 2 * half },
      { x: x0 - pad, y: y1 - half, width: loopWidth + 2 * pad, height: 2 * half },
      { x: x0 - half, y: y0, width: 2 * half, height: loopHeight },
      { x: x1 - half, y: y0, width: 2 * half, height: loopHeight },
    ],
    battery,
    resistor,
    arrow,
    flow: { count, spacing, rate, speed: rate * spacing },
  };
}

// Clockwise from the bottom-left corner: up the source, across the resistor, back down.
export function pointOnLoop(loop: LoopGeometry, distance: number): Vec {
  const { x0, y0, x1, y1, width, height, length } = loop;
  const d = ((distance % length) + length) % length;
  if (d < height) return [x0, y1 - d];
  if (d < height + width) return [x0 + d - height, y0];
  if (d < 2 * height + width) return [x1, y0 + d - height - width];
  return [x1 - (d - 2 * height - width), y1];
}

export function carrierPoints(geometry: CircuitGeometry, seconds: number): Vec[] {
  const { loop, flow } = geometry;
  return Array.from({ length: flow.count }, (_, k) =>
    pointOnLoop(loop, flow.speed * seconds + k * flow.spacing),
  );
}

// A carrier that would only half disappear behind a part is left out instead.
export function isCovered(bodies: readonly Rect[], point: Vec, radius: number): boolean {
  return bodies.some(
    ({ x, y, width, height }) =>
      point[0] > x - radius &&
      point[0] < x + width + radius &&
      point[1] > y - radius &&
      point[1] < y + height + radius,
  );
}
