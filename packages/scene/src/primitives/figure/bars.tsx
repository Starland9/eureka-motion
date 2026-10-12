import type { PrimitiveProps } from "../../composition/context";
import { formatNumberParts, resolve, type NumberParts } from "../../expr";
import {
  colourOf,
  drawStyle,
  fontOf,
  labelOpacity,
  labelRise,
  strokeWidth,
  textSize,
} from "../shared";
import { NumberText, partsWidth } from "./a-value";

const INSET_U = 2;
const BAR_SHARE = 0.56;
const MAX_BAR_U = 20;
const CAPTION_GAP_U = 1.2;
const VALUE_GAP_U = 0.8;
const EDGE_U = 0.5;
const LINE_HEIGHT = 1.25;
const CAPTION_BASELINE = 0.8;
const TRACKING = 0.06;
const ADVANCE = 0.6 + TRACKING;
const FIT = 0.98;

function wrap(text: string, chars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > chars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Bar {
  caption: string[];
  colour: string;
  parts: NumberParts;
  value: number;
  width: number;
}

export function BarsPrimitive({ element, ctx }: PrimitiveProps<"bars">) {
  const state = ctx.state.of(element.id);
  const { u, theme, size: slot } = ctx;
  const size = textSize(ctx, "label");
  const lineHeight = size * LINE_HEIGHT;
  const left = INSET_U * u;
  const right = slot.width - INSET_U * u;
  const cell = (right - left) / element.items.length;
  const barWidth = Math.min(cell * BAR_SHARE, MAX_BAR_U * u);
  const unit = element.unit ? `\u00A0${element.unit}` : "";
  const chars = Math.max(1, Math.floor((cell * FIT) / (ADVANCE * size)));

  const bars: Bar[] = element.items.map((item) => {
    const value = resolve(item.value, ctx.scope);
    const parts = formatNumberParts(value, undefined, ctx.language);
    return {
      caption: wrap(item.label.toLocaleUpperCase(ctx.language), chars),
      colour: colourOf(ctx, item.role, "quantity"),
      parts,
      width: partsWidth(parts, size, unit),
      value: Number.isFinite(value) ? Math.max(0, value) : 0,
    };
  });

  const stacked = unit !== "" && bars.some((bar) => bar.width > cell * FIT);
  const largest = Math.max(0, ...bars.map((bar) => bar.value));
  const captionLines = Math.max(1, ...bars.map((bar) => bar.caption.length));
  const baseline = slot.height - EDGE_U * u - captionLines * lineHeight - CAPTION_GAP_U * u;
  const valueLines = stacked ? 2 : 1;
  const room = Math.max(0, baseline - EDGE_U * u - valueLines * lineHeight - VALUE_GAP_U * u);
  const growth = state.how === "draw" ? state.progress : 1;
  const textOpacity = labelOpacity(state);
  const rise = labelRise(ctx, state);

  const placed = bars.map((bar, i) => {
    const height = largest > 0 ? (bar.value / largest) * room * growth : 0;
    const centre = left + cell * i + cell / 2;
    return { ...bar, height, centre, x: centre - barWidth / 2, top: baseline - height };
  });

  return (
    <g>
      <g opacity={state.opacity}>
        <line
          data-part="baseline"
          x1={left}
          y1={baseline}
          x2={right}
          y2={baseline}
          stroke={theme.ink}
          strokeWidth={strokeWidth(ctx, "regular")}
          {...drawStyle(state, right - left)}
        />
        {placed.map((bar, i) => (
          <rect
            key={i}
            data-part="bar"
            x={bar.x}
            y={bar.top}
            width={barWidth}
            height={bar.height}
            fill={bar.colour}
            stroke={theme.ink}
            strokeWidth={strokeWidth(ctx, "regular")}
          />
        ))}
      </g>
      {placed.map((bar, i) => {
        const valueY = bar.top - VALUE_GAP_U * u + rise;
        return (
          <g key={i}>
            <text
              data-part="caption"
              textAnchor="middle"
              fontFamily={fontOf("mono")}
              fontWeight={500}
              fontSize={size}
              letterSpacing={size * TRACKING}
              fill={theme.ink}
              opacity={state.opacity}
            >
              {bar.caption.map((line, row) => (
                <tspan
                  key={row}
                  x={bar.centre}
                  y={baseline + CAPTION_GAP_U * u + size * CAPTION_BASELINE + row * lineHeight}
                >
                  {line}
                </tspan>
              ))}
            </text>
            <NumberText
              partName="value"
              parts={bar.parts}
              tail={stacked ? undefined : unit}
              x={bar.centre}
              y={stacked ? valueY - lineHeight : valueY}
              size={size}
              anchor="middle"
              baseline="alphabetic"
              fill={theme.ink}
              opacity={textOpacity}
            />
            {stacked ? (
              <text
                data-part="unit"
                x={bar.centre}
                y={valueY}
                textAnchor="middle"
                fontFamily={fontOf("mono")}
                fontWeight={500}
                fontSize={size}
                fill={theme.ink}
                opacity={textOpacity}
              >
                {element.unit}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
