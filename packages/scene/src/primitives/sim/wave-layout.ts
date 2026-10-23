type Vec = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WaveInput {
  amplitudeRatio: number;
  frequencyRatio: number;
  speedRatio: number;
}

export interface RulerGeometry {
  y: number;
  left: number;
  right: number;
  tick: number;
  label: Vec;
  band: Rect;
}

export interface GaugeGeometry {
  x: number;
  top: number;
  bottom: number;
  tick: number;
  levelFrom: number;
  label: Vec;
  band: Rect;
}

export interface WaveGeometry {
  left: number;
  right: number;
  axisY: number;
  amplitude: number;
  wavelength: number;
  rate: number;
  samples: number;
  ruler: RulerGeometry;
  gauge: GaugeGeometry;
  curveBand: Rect;
}

// Cycles per simulated second at the default frequency.
export const REFERENCE_RATE = 1;
// Beyond this the phase advances by over an eighth of a cycle per frame and reads as a blur.
export const MAX_RATE_RATIO = 4;

const GAUGE_ROOM_U = 9;
const SIDE_MARGIN_U = 3;
const LABEL_CENTRE_U = 3.5;
const LABEL_HALF_HEIGHT_U = 1.4;
const RULER_GAP_U = 1.2;
const RULER_RISE_U = 2.4;
const BAND_HALF_HEIGHT_U = 1;
const TICK_U = 0.8;
const REGION_GAP_U = 1.5;
const BOTTOM_U = 3;
const AMPLITUDE_SHARE = 0.45;
const WAVELENGTH_SHARE = 0.28;
const MIN_WAVELENGTH_U = 3.5;
const GAUGE_GAP_U = 2.5;
const GAUGE_LABEL_GAP_U = 1.8;
const OVERSHOOT_U = 0.8;
const SAMPLE_PX = 3;
const BAND_PAD_U = 0.5;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function wavelengthRatio(frequencyRatio: number, speedRatio: number): number {
  return frequencyRatio > 0 ? speedRatio / frequencyRatio : Number.POSITIVE_INFINITY;
}

export function waveLayout(
  slot: { width: number; height: number },
  u: number,
  input: WaveInput,
): WaveGeometry {
  const { width, height } = slot;
  const left = GAUGE_ROOM_U * u;
  const right = width - SIDE_MARGIN_U * u;
  const reach = right - left;

  const rulerFloor = (LABEL_CENTRE_U + LABEL_HALF_HEIGHT_U + RULER_GAP_U) * u;
  const tick = TICK_U * u;
  const top = rulerFloor + tick + REGION_GAP_U * u;
  const bottom = height - BOTTOM_U * u;
  const halfHeight = Math.max(0, (bottom - top) / 2);
  const axisY = top + halfHeight;

  const amplitude = clamp(AMPLITUDE_SHARE * halfHeight * input.amplitudeRatio, 0, halfHeight);
  const minWavelength = Math.min(MIN_WAVELENGTH_U * u, reach);
  const wavelength = clamp(
    WAVELENGTH_SHARE * reach * wavelengthRatio(input.frequencyRatio, input.speedRatio),
    minWavelength,
    reach,
  );
  const rate = REFERENCE_RATE * Math.min(Math.max(0, input.frequencyRatio), MAX_RATE_RATIO);

  const rulerY = Math.max(rulerFloor, axisY - amplitude - RULER_RISE_U * u);
  const labelY = rulerY - (LABEL_HALF_HEIGHT_U + RULER_GAP_U) * u;
  const pad = BAND_PAD_U * u;
  const half = BAND_HALF_HEIGHT_U * u;
  const gaugeX = left - GAUGE_GAP_U * u;
  const gaugeLabelX = gaugeX - GAUGE_LABEL_GAP_U * u;

  return {
    left,
    right,
    axisY,
    amplitude,
    wavelength,
    rate,
    samples: Math.max(2, Math.ceil(reach / SAMPLE_PX)),
    ruler: {
      y: rulerY,
      left,
      right: left + wavelength,
      tick,
      label: [left + wavelength / 2, labelY],
      band: { x: left - pad, y: rulerY - half, width: wavelength + 2 * pad, height: 2 * half },
    },
    gauge: {
      x: gaugeX,
      top: axisY - amplitude,
      bottom: axisY,
      tick,
      levelFrom: gaugeX - OVERSHOOT_U * u,
      label: [gaugeLabelX, axisY - amplitude / 2],
      band: {
        x: gaugeX - tick - pad,
        y: axisY - amplitude - pad,
        width: 2 * (tick + pad),
        height: amplitude + 2 * pad,
      },
    },
    curveBand: {
      x: left - pad,
      y: axisY - amplitude - pad,
      width: reach + 2 * pad,
      height: 2 * amplitude + 2 * pad,
    },
  };
}

export function waveCurve(geometry: WaveGeometry, phase: number): Vec[] {
  const { left, right, axisY, amplitude, wavelength, samples } = geometry;
  return Array.from({ length: samples + 1 }, (_, k) => {
    const x = left + ((right - left) * k) / samples;
    return [x, axisY - amplitude * Math.cos(2 * Math.PI * ((x - left) / wavelength - phase))];
  });
}
