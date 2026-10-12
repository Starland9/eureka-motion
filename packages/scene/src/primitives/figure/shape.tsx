import type { PrimitiveProps } from "../../composition/context";
import type { ElementOf } from "../../schema/document";
import { drawStyle, FigureLabel, HatchPattern, hatchId, strokeWidth } from "../shared";
import { clamp01, figureSpace } from "./b-geometry";
import { clearance, labelBox, labelColour, labelText, lineColour } from "./b-label";
import {
  boundsOf,
  innerPoint,
  isFullCircle,
  lengthOf,
  outerPoint,
  outlineOf,
  pathOf,
  type Outline,
} from "./b-shape";

const FILL_APPEARS_AT = 0.6;

interface Paint {
  fill: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: number;
  strokeDashoffset?: number;
  clipPath?: string;
}

function Body({ outline, sector, paint }: { outline: Outline; sector: boolean; paint: Paint }) {
  const common = { ...paint, strokeLinejoin: "miter" } as const;
  if (outline.kind === "rect") {
    return (
      <rect
        x={outline.centre[0] - outline.width / 2}
        y={outline.centre[1] - outline.height / 2}
        width={outline.width}
        height={outline.height}
        {...common}
      />
    );
  }
  if (outline.kind === "polygon") {
    return <polygon points={outline.points.map((p) => p.join(",")).join(" ")} {...common} />;
  }
  if (outline.kind === "circle" || isFullCircle(outline)) {
    return <circle cx={outline.centre[0]} cy={outline.centre[1]} r={outline.radius} {...common} />;
  }
  return <path d={pathOf(outline, sector)} {...common} />;
}

export function ShapePrimitive({ element, ctx }: PrimitiveProps<"shape">) {
  const space = figureSpace(ctx);
  const current = space ? (space.lookup.get(element.id) as ElementOf<"shape"> | undefined) : null;
  const outline = space ? outlineOf(current ?? element, space, ctx) : null;
  if (!outline) return null;

  const state = ctx.state.of(element.id);
  const fill = element.fill ?? "none";
  const filled = fill !== "none";
  const sector = filled && outline.kind === "arc";
  const id = hatchId(element.id);
  const highlightId = `highlight-${element.id}`;
  const stroke = lineColour(ctx, element.role);
  const fillPaint =
    fill === "hatch" ? `url(#${id})` : fill === "none" ? "none" : ctx.theme.role[fill];
  const fillOpacity =
    state.how === "draw" ? clamp01((state.progress - FILL_APPEARS_AT) / (1 - FILL_APPEARS_AT)) : 1;
  const bounds = boundsOf(outline);

  const base = filled ? (
    <Body outline={outline} sector={sector} paint={{ fill: fillPaint, fillOpacity }} />
  ) : null;
  const wash =
    state.highlight > 0 ? (
      <Body
        outline={outline}
        sector={outline.kind === "arc"}
        paint={{ fill: ctx.theme.role.result, clipPath: `url(#${highlightId})` }}
      />
    ) : null;

  const label = element.label;
  const box = label ? labelBox(ctx, label) : null;
  const at = box
    ? filled
      ? innerPoint(outline)
      : outerPoint(outline, box, clearance(ctx, 0))
    : null;

  return (
    <g>
      <g opacity={state.opacity}>
        {fill === "hatch" ? (
          <defs>
            <HatchPattern ctx={ctx} id={id} colour={lineColour(ctx, element.role, "inkSoft")} />
          </defs>
        ) : null}
        {state.highlight > 0 ? (
          <defs>
            <clipPath id={highlightId}>
              <rect
                x={bounds.x}
                y={bounds.y}
                width={bounds.width * state.highlight}
                height={bounds.height}
              />
            </clipPath>
          </defs>
        ) : null}
        {fill === "hatch" ? (
          <>
            {wash}
            {base}
          </>
        ) : (
          <>
            {base}
            {wash}
          </>
        )}
        <Body
          outline={outline}
          sector={sector}
          paint={{
            fill: "none",
            stroke,
            strokeWidth: strokeWidth(ctx, "regular"),
            ...drawStyle(state, lengthOf(outline, sector)),
          }}
        />
      </g>
      {label && at ? (
        <FigureLabel
          ctx={ctx}
          state={state}
          x={at[0]}
          y={at[1]}
          text={labelText(label)}
          colour={filled ? "ink" : labelColour(element.role)}
        />
      ) : null}
    </g>
  );
}
