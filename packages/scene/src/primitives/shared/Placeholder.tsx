import type { ComponentType } from "react";
import type { PrimitiveProps } from "../../composition/context";
import type { ElementType } from "../../schema/document";
import { fontOf, strokeWidth, textSize } from "./style";

function SvgPlaceholder({ element, ctx }: PrimitiveProps) {
  const state = ctx.state.of(element.id);
  const inset = ctx.u;
  return (
    <g opacity={state.opacity}>
      <rect
        x={inset}
        y={inset}
        width={Math.max(0, ctx.size.width - 2 * inset)}
        height={Math.max(0, ctx.size.height - 2 * inset)}
        fill="none"
        stroke={ctx.theme.rule}
        strokeWidth={strokeWidth(ctx, "regular")}
        strokeDasharray={`${ctx.u} ${ctx.u}`}
      />
      <text
        x={ctx.size.width / 2}
        y={ctx.size.height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily={fontOf("mono")}
        fontSize={textSize(ctx, "label")}
        fill={ctx.theme.inkFaint}
      >
        {element.type}
      </text>
    </g>
  );
}

function HtmlPlaceholder({ element, ctx }: PrimitiveProps) {
  const state = ctx.state.of(element.id);
  return (
    <div
      style={{
        opacity: state.opacity,
        fontFamily: fontOf("mono"),
        fontSize: textSize(ctx, "label"),
        color: ctx.theme.inkFaint,
        border: `${strokeWidth(ctx, "regular")}px dashed ${ctx.theme.rule}`,
        padding: ctx.u,
      }}
    >
      {element.type}
    </div>
  );
}

export const PLACEHOLDER = Symbol("placeholder");

type Marked<T extends ElementType> = ComponentType<PrimitiveProps<T>> & { [PLACEHOLDER]?: true };

function mark<T extends ElementType>(component: ComponentType<PrimitiveProps>): Marked<T> {
  const marked = component as unknown as Marked<T>;
  marked[PLACEHOLDER] = true;
  return marked;
}

export function svgPlaceholder<T extends ElementType>(): ComponentType<PrimitiveProps<T>> {
  return mark<T>((props) => <SvgPlaceholder {...props} />);
}

export function htmlPlaceholder<T extends ElementType>(): ComponentType<PrimitiveProps<T>> {
  return mark<T>((props) => <HtmlPlaceholder {...props} />);
}

export function isPlaceholder(component: unknown): boolean {
  return (
    typeof component === "function" && (component as Marked<ElementType>)[PLACEHOLDER] === true
  );
}
