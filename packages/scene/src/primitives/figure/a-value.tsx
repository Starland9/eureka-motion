import type { NumberParts } from "../../expr";
import { fontOf } from "../shared";

const SUPER_SCALE = 0.65;
const SUPER_RAISE = 0.4;
const MONO_ADVANCE = 0.6;
const TIMES_TEN = "\u00A0×\u00A010";
const TIGHT_TIMES_TEN = "×10";

const signed = (exponent: number): string =>
  exponent < 0 ? `−${Math.abs(exponent)}` : String(exponent);

export function partsWidth(parts: NumberParts, size: number, tail = "", tight = false): number {
  const times = tight ? TIGHT_TIMES_TEN : TIMES_TEN;
  const power =
    parts.exponent === null ? 0 : times.length + SUPER_SCALE * signed(parts.exponent).length;
  return (parts.mantissa.length + parts.suffix.length + tail.length + power) * MONO_ADVANCE * size;
}

export interface NumberTextProps {
  parts: NumberParts;
  tail?: string;
  x: number;
  y: number;
  size: number;
  anchor: "start" | "middle" | "end";
  baseline: "alphabetic" | "middle";
  fill: string;
  opacity?: number;
  partName?: string;
  tight?: boolean;
}

export function NumberText({
  parts,
  tail,
  x,
  y,
  size,
  anchor,
  baseline,
  fill,
  opacity,
  partName,
  tight,
}: NumberTextProps) {
  const raise = size * SUPER_RAISE;
  return (
    <text
      data-part={partName}
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline={baseline}
      fontFamily={fontOf("mono")}
      fontWeight={500}
      fontSize={size}
      fill={fill}
      opacity={opacity}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {parts.mantissa}
      {parts.exponent === null ? null : (
        <>
          {tight ? TIGHT_TIMES_TEN : TIMES_TEN}
          <tspan data-part="exponent" dy={-raise} fontSize={size * SUPER_SCALE}>
            {signed(parts.exponent)}
          </tspan>
        </>
      )}
      {parts.suffix}
      {tail ? (
        <tspan dy={parts.exponent === null ? undefined : raise} fontSize={size}>
          {tail}
        </tspan>
      ) : null}
    </text>
  );
}
