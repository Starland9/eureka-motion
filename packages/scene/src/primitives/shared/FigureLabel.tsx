import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import type { SceneColour } from "../../tokens";
import { labelOpacity, labelRise } from "./anim";
import { colourOf, fontOf, textSize } from "./style";

export interface FigureLabelProps {
  ctx: SceneContext;
  state: ElementState;
  x: number;
  y: number;
  text: string;
  colour?: SceneColour;
  anchor?: "start" | "middle" | "end";
  italic?: boolean;
}

export function FigureLabel({
  ctx,
  state,
  x,
  y,
  text,
  colour,
  anchor = "middle",
  italic = false,
}: FigureLabelProps) {
  const size = textSize(ctx, "label");
  return (
    <text
      x={x}
      y={y + labelRise(ctx, state)}
      textAnchor={anchor}
      dominantBaseline="middle"
      fontFamily={fontOf(italic ? "text" : "mono")}
      fontStyle={italic ? "italic" : "normal"}
      fontWeight={500}
      fontSize={size}
      fill={colourOf(ctx, colour)}
      stroke={ctx.theme.surfaceRaised}
      strokeWidth={size * 0.22}
      paintOrder="stroke"
      opacity={labelOpacity(state)}
    >
      {text}
    </text>
  );
}
