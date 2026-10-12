import type { CSSProperties, ReactNode } from "react";
import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";

const SWITCH_AT = 0.5;

export function highlightTextColour(
  ctx: Pick<SceneContext, "theme">,
  state: ElementState,
  base: string,
): string {
  if (state.highlight < SWITCH_AT) return base;
  return ctx.theme.name === "paper" ? ctx.theme.ink : ctx.theme.surface;
}

export interface HighlightedProps {
  ctx: SceneContext;
  state: ElementState;
  children: ReactNode;
  style?: CSSProperties;
}

export function Highlighted({ ctx, state, children, style }: HighlightedProps) {
  const pad = 0.4 * ctx.u;
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      {state.highlight > 0 ? (
        <span
          style={{
            position: "absolute",
            left: -pad,
            top: 0,
            bottom: 0,
            width: `calc(${state.highlight * 100}% + ${2 * pad * state.highlight}px)`,
            backgroundColor: ctx.theme.role.result,
          }}
        />
      ) : null}
      <span style={{ position: "relative" }}>{children}</span>
    </span>
  );
}

export interface SvgHighlightProps {
  ctx: SceneContext;
  state: ElementState;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SvgHighlight({ ctx, state, x, y, width, height }: SvgHighlightProps) {
  if (state.highlight <= 0) return null;
  return (
    <rect
      x={x}
      y={y}
      width={width * state.highlight}
      height={height}
      fill={ctx.theme.role.result}
    />
  );
}
