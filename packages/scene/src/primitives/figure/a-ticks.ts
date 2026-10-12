import { formatNumberParts, type Language, type NumberParts } from "../../expr";

export interface TickSet {
  step: number;
  values: number[];
}

const MANTISSAS = [1, 2, 5] as const;
const SCIENTIFIC_ABOVE = 1e6;
const SCIENTIFIC_BELOW = 1e-3;
const MAX_DIGITS = 6;

function ticksAt(min: number, max: number, step: number): number[] {
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  const values: number[] = [];
  for (let k = first; k <= last; k += 1) values.push(Number((k * step).toPrecision(12)));
  return values;
}

export function niceTicks(min: number, max: number, count: number): TickSet {
  let best: TickSet = { step: 1, values: [] };
  if (count <= 0 || !(max > min)) return best;
  const exponent = Math.floor(Math.log10((max - min) / count));
  let bestMiss = Infinity;
  for (let e = exponent - 1; e <= exponent + 1; e += 1) {
    for (const mantissa of MANTISSAS) {
      const step = mantissa * 10 ** e;
      const values = ticksAt(min, max, step);
      const miss = Math.abs(values.filter((value) => value !== 0).length - count);
      if (values.length > 0 && (miss < bestMiss || (miss === bestMiss && step > best.step))) {
        best = { step, values };
        bestMiss = miss;
      }
    }
  }
  return best;
}

export function tickParts(set: TickSet, language: Language): NumberParts[] {
  const biggest = Math.max(0, ...set.values.map(Math.abs));
  const stepExponent = Math.floor(Math.log10(set.step) + 1e-9);
  const scientific = biggest >= SCIENTIFIC_ABOVE || (biggest > 0 && biggest < SCIENTIFIC_BELOW);
  const digits = scientific ? Math.floor(Math.log10(biggest) + 1e-9) - stepExponent : -stepExponent;
  const format = {
    kind: scientific ? "sci" : "fixed",
    digits: Math.min(MAX_DIGITS, Math.max(0, digits)),
  } as const;
  return set.values.map((value) =>
    value === 0
      ? formatNumberParts(0, { kind: "int" }, language)
      : formatNumberParts(value, format, language),
  );
}
