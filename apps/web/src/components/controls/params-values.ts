import {
  buildScope,
  DEFAULT_FORMAT,
  formatNumber,
  formatNumberParts,
  parseFormat,
  type Language,
  type Model,
  type NumberFormat,
  type Param,
} from "scene";

export type ParamBounds = Pick<Param, "min" | "max">;
export type ParamGrid = Pick<Param, "min" | "max" | "step">;

export interface ParamResult {
  id: string;
  symbol?: string;
  label: string;
  unit: string;
  value: number;
  format?: string;
}

export type Entry = { kind: "invalid" } | { kind: "value"; value: number; clamped: boolean };

const SIGNIFICANT_MAX = 12;
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const ENTRY = /^([+-]?\d+\.?\d*|[+-]?\.\d+)(?:e([+-]?\d+)|[×x*·]10\^?([+-]?\d+))?$/i;

export function tidy(value: number): number {
  return Number(value.toPrecision(SIGNIFICANT_MAX));
}

export function clampToRange(value: number, bounds: ParamBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function currentValue(param: Param, values: Readonly<Record<string, number>>): number {
  const raw = values[param.id];
  return clampToRange(typeof raw === "number" && Number.isFinite(raw) ? raw : param.default, param);
}

// The range input can only rest on min + k * step; the exact value stays in the state.
export function snapToStep(value: number, grid: ParamGrid): number {
  const last = Math.floor((grid.max - grid.min) / grid.step + 1e-9);
  const k = Math.min(last, Math.max(0, Math.round((value - grid.min) / grid.step)));
  return clampToRange(tidy(grid.min + k * grid.step), grid);
}

export function fractionOf(value: number, bounds: ParamBounds): number {
  const span = bounds.max - bounds.min;
  return span > 0 ? clampToRange((value - bounds.min) / span, { min: 0, max: 1 }) : 0;
}

function significantDigits(value: number): number {
  if (value === 0) return 1;
  const [mantissa = ""] = tidy(value).toExponential().split("e");
  return Math.min(SIGNIFICANT_MAX, mantissa.replace(/\D/g, "").length);
}

function lossless(value: number): NumberFormat {
  return { kind: "sig", digits: significantDigits(value) };
}

export function formatValue(value: number, language: Language): string {
  return formatNumber(value, lossless(value), language);
}

export function formatResult(result: ParamResult, language: Language): string {
  let format = DEFAULT_FORMAT;
  if (result.format !== undefined) {
    try {
      format = parseFormat(result.format);
    } catch {
      format = DEFAULT_FORMAT;
    }
  }
  return formatNumber(result.value, format, language);
}

export function editText(value: number, language: Language): string {
  const parts = formatNumberParts(value, lossless(value), language);
  const mantissa = parts.mantissa.replace(language === "en" ? /,/g : /\s/g, "");
  return parts.exponent === null ? mantissa : `${mantissa}e${parts.exponent}`;
}

function normalizeEntry(text: string, language: Language): string {
  const plain = text
    .replace(/[−–]/g, "-")
    .replace(/\s/g, "")
    .replace(/⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => {
      const sign = run.startsWith("⁻") ? "-" : "";
      const digits = [...run].filter((c) => c !== "⁻").map((c) => SUPERSCRIPTS.indexOf(c));
      return `^${sign}${digits.join("")}`;
    });
  return language === "en" ? plain.replace(/,/g, "") : plain.replace(/,/g, ".");
}

export function parseEntry(text: string, language: Language): number | null {
  const match = ENTRY.exec(normalizeEntry(text, language));
  if (match === null) return null;
  const [, mantissa = "", exponentE, exponentTimes] = match;
  const value = Number(`${mantissa}e${exponentE ?? exponentTimes ?? "0"}`);
  return Number.isFinite(value) ? tidy(value) : null;
}

export function commitEntry(text: string, bounds: ParamBounds, language: Language): Entry {
  const parsed = parseEntry(text, language);
  if (parsed === null) return { kind: "invalid" };
  const value = clampToRange(parsed, bounds);
  return { kind: "value", value, clamped: value !== parsed };
}

export function deriveResults(
  params: readonly Param[],
  model: Model,
  values: Readonly<Record<string, number>>,
): ParamResult[] {
  const scope = buildScope({ params, constants: model.constants, derived: model.derived }, values);
  return model.derived
    .filter((derived) => derived.label !== "")
    .map((derived) => ({
      id: derived.id,
      symbol: derived.symbol,
      label: derived.label,
      unit: derived.unit,
      value: scope[derived.id] ?? Number.NaN,
      format: derived.format,
    }));
}
