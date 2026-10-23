import type { NumberParts } from "../../expr";
import { sceneMetrics } from "../../tokens";

export interface ReadoutSpec {
  label: string;
  mantissaChars: number;
  exponentChars: number;
  unitChars: number;
}

export interface ReadoutBox {
  width: number;
  height: number;
  u: number;
}

export interface ReadoutPlan {
  labelSize: number;
  valueSize: number;
  stacked: boolean;
  fits: boolean;
}

export const LABEL_LINE = 1.25;
export const VALUE_LINE = 1.15;
export const COLUMN_GAP_U = 2;
export const PAD_U = 0.3;

const STACKED_VALUE_U = 6;
const UNIT_ALLOWANCE_U = 4;
// Gap that SceneFrame leaves between the html elements of a slot.
const SLOT_GAP_U = 2.5;
// "1,98 × 10⁻²⁰" in IBM Plex Mono, with the exponent set at 0.6 em.
const WIDEST_STACKED_VALUE_EM = 6.5;
const EXPONENT_BASE_CHARS = 5;
const EXPONENT_EM = 0.6;
const LABEL_ADVANCE_EM = 0.66;
const VALUE_ADVANCE_EM = 0.6;
const WIDTH_SLACK = 1.02;
// Baseline alignment of a label and a value of different sizes adds a little to a line.
const BASELINE_EM = 0.03;
// Down to half the minimum text size, as the nodes of a relation do: a smaller text is the
// lesser evil, and what still does not fit is left to the scale of the whole slot.
const SHRINK_SCALES = Array.from({ length: 11 }, (_, i) => (20 - i) / 20);

export function widestValue(
  values: readonly NumberParts[],
): Pick<ReadoutSpec, "mantissaChars" | "exponentChars"> {
  const chars = values.map((value) => ({
    mantissaChars: value.mantissa.length + value.suffix.length,
    exponentChars: value.exponent === null ? 0 : String(value.exponent).length,
  }));
  const total = (item: (typeof chars)[number]): number =>
    item.mantissaChars + (item.exponentChars > 0 ? EXPONENT_BASE_CHARS + item.exponentChars : 0);
  return chars.reduce((widest, item) => (total(item) > total(widest) ? item : widest));
}

export interface ReadoutMeasure {
  height: number;
  row: boolean;
  shaped: boolean;
}

function labelLines(label: string, size: number, width: number) {
  const perLine = Math.floor(width / (LABEL_ADVANCE_EM * size * WIDTH_SLACK));
  let lines = 1;
  let used = 0;
  let shaped = true;
  for (const word of label.split(/[ \t\n]+/).filter(Boolean)) {
    if (word.length > perLine) shaped = false;
    if (used === 0) used = word.length;
    else if (used + 1 + word.length <= perLine) used += 1 + word.length;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return { height: lines, shaped };
}

function valueWidths(spec: ReadoutSpec, valueSize: number, labelSize: number) {
  const hasExponent = spec.exponentChars > 0;
  const mantissaEm =
    (spec.mantissaChars + (hasExponent ? EXPONENT_BASE_CHARS : 0)) * VALUE_ADVANCE_EM +
    spec.exponentChars * VALUE_ADVANCE_EM * EXPONENT_EM;
  const unitEm = spec.unitChars > 0 ? (1 + spec.unitChars) * VALUE_ADVANCE_EM : 0;
  return {
    mantissa: mantissaEm * valueSize * WIDTH_SLACK,
    unit: unitEm * labelSize * WIDTH_SLACK,
  };
}

// Label and value share a line when they fit it; otherwise the value drops under the label.
export function measureReadout(
  spec: ReadoutSpec,
  plan: Pick<ReadoutPlan, "labelSize" | "valueSize" | "stacked">,
  box: Pick<ReadoutBox, "width" | "u">,
): ReadoutMeasure {
  const { labelSize, valueSize, stacked } = plan;
  const label = labelLines(spec.label, labelSize, box.width);
  const { mantissa, unit } = valueWidths(spec, valueSize, labelSize);
  const pad = 2 * PAD_U * box.u;
  const labelHeight = label.height * labelSize * LABEL_LINE;
  if (!stacked) {
    const labelWidth = spec.label.length * LABEL_ADVANCE_EM * labelSize * WIDTH_SLACK;
    if (label.height === 1 && labelWidth + COLUMN_GAP_U * box.u + mantissa + unit <= box.width) {
      return {
        height: Math.max(labelHeight, valueSize * VALUE_LINE) + BASELINE_EM * valueSize + pad,
        row: true,
        shaped: true,
      };
    }
  }
  const valueLines = mantissa + unit <= box.width ? 1 : 2;
  return {
    height: labelHeight + valueLines * valueSize * VALUE_LINE + pad,
    row: false,
    shaped: label.shaped && mantissa <= box.width && unit <= box.width,
  };
}

export function planReadouts(specs: readonly ReadoutSpec[], box: ReadoutBox): ReadoutPlan {
  const { width, height, u } = box;
  const gap = SLOT_GAP_U * u;
  const assess = (labelSize: number, valueSize: number, stacked: boolean): ReadoutPlan => {
    const plan = { labelSize, valueSize, stacked };
    let total = (specs.length - 1) * gap;
    let shaped = true;
    for (const spec of specs) {
      const measure = measureReadout(spec, plan, box);
      total += measure.height;
      shaped &&= measure.shaped;
    }
    return { ...plan, fits: shaped && total <= height };
  };

  const stackedValue = Math.min(
    STACKED_VALUE_U * u,
    (width - UNIT_ALLOWANCE_U * u) / WIDEST_STACKED_VALUE_EM,
  );
  const nominal = assess(sceneMetrics.text.label * u, stackedValue, true);
  if (nominal.fits) return nominal;

  let last = nominal;
  for (const scale of SHRINK_SCALES) {
    last = assess(sceneMetrics.text.label * u * scale, sceneMetrics.text.body * u * scale, false);
    if (last.fits) return last;
  }
  return last;
}
