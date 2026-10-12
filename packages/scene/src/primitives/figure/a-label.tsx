import { FigureLabel, labelOpacity, labelRise, textSize, type FigureLabelProps } from "../shared";

const MONO_ADVANCE = 0.6;
const ITALIC_ADVANCE = 0.5;
const PAD_U = 0.4;
const HEIGHT = 1;

export function textWidth(text: string, size: number, italic: boolean): number {
  return text.length * (italic ? ITALIC_ADVANCE : MONO_ADVANCE) * size;
}

export interface PlateProps {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: "start" | "middle" | "end";
  fill: string;
  opacity: number;
}

export function Plate({ x, y, width, height, anchor, fill, opacity }: PlateProps) {
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return (
    <rect
      data-part="plate"
      x={left}
      y={y - height / 2}
      width={width}
      height={height}
      fill={fill}
      opacity={opacity}
    />
  );
}

export function PlateLabel(props: FigureLabelProps) {
  const { ctx, state, x, y, text, anchor = "middle", italic = false } = props;
  const size = textSize(ctx, "label");
  const pad = PAD_U * ctx.u;
  const edge = anchor === "start" ? -pad : anchor === "end" ? pad : 0;
  return (
    <>
      <Plate
        x={x + edge}
        y={y + labelRise(ctx, state)}
        width={textWidth(text, size, italic) + 2 * pad}
        height={size * HEIGHT}
        anchor={anchor}
        fill={ctx.theme.surfaceRaised}
        opacity={labelOpacity(state)}
      />
      <FigureLabel {...props} />
    </>
  );
}
