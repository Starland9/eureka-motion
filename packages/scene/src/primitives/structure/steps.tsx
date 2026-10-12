import type { CSSProperties } from "react";
import type { PrimitiveProps } from "../../composition/context";
import { typeScale } from "../../tokens";
import {
  colourOf,
  fontOf,
  Highlighted,
  highlightTextColour,
  px,
  strokeWidth,
  textSize,
} from "../shared";
import { partId, proseSize, sequenced } from "./motion";

const COLUMN_GAP_U = 2.5;
const NUMERAL_COLUMN_U = 6;
const SPACE_U = 1.5;
const ROW_PAD_U = 1.2;
const DETAIL_GAP_U = 0.75;

export function StepsPrimitive({ element, ctx }: PrimitiveProps<"steps">) {
  const count = element.items.length;
  const whole = ctx.state.of(element.id);
  const stacked = ctx.slot === "notes";
  const textWidth = stacked
    ? ctx.size.width - px(ctx, NUMERAL_COLUMN_U)
    : ctx.size.width / count - px(ctx, COLUMN_GAP_U);
  const labelSize = textSize(
    ctx,
    proseSize(
      ctx,
      element.items.map((item) => item.label),
      textWidth,
    ),
  );
  const detailSize = textSize(ctx, "min");

  const numeralStyle: CSSProperties = {
    fontFamily: fontOf("mono"),
    fontWeight: typeScale.caption.weight,
    fontSize: textSize(ctx, "label"),
    lineHeight: 1.2,
    fontVariantNumeric: "tabular-nums",
    color: colourOf(ctx, "inkFaint"),
  };

  return (
    <ol
      lang={ctx.language}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gridTemplateColumns: stacked ? "minmax(0, 1fr)" : `repeat(${count}, minmax(0, 1fr))`,
        columnGap: px(ctx, COLUMN_GAP_U),
      }}
    >
      {element.items.map((item, index) => {
        const part = partId("s", index);
        const state = ctx.state.of(`${element.id}.${part}`);
        const step = sequenced(state, whole, index, count);
        const numeral = String(index + 1).padStart(2, "0");
        const rule = (
          <div
            aria-hidden
            data-role="rule"
            style={{
              height: strokeWidth(ctx, "construction"),
              backgroundColor: ctx.theme.rule,
              transformOrigin: "left center",
              transform: `scaleX(${step.trace})`,
            }}
          />
        );
        const text = (
          <div
            style={{
              opacity: step.caption,
              fontFamily: fontOf("text"),
              overflowWrap: "anywhere",
            }}
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: labelSize,
                lineHeight: 1.2,
                color: highlightTextColour(ctx, state, colourOf(ctx, "ink")),
              }}
            >
              <Highlighted ctx={ctx} state={state}>
                {item.label}
              </Highlighted>
            </div>
            {item.detail ? (
              <div
                style={{
                  marginTop: px(ctx, DETAIL_GAP_U),
                  fontSize: detailSize,
                  lineHeight: 1.3,
                  color: colourOf(ctx, "inkSoft"),
                }}
              >
                {item.detail}
              </div>
            ) : null}
          </div>
        );
        return (
          <li
            key={part}
            data-part={part}
            style={{ minWidth: 0, opacity: step.opacity, overflowWrap: "anywhere" }}
          >
            {stacked ? (
              <>
                {rule}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `${px(ctx, NUMERAL_COLUMN_U)}px minmax(0, 1fr)`,
                    padding: `${px(ctx, ROW_PAD_U)}px 0`,
                  }}
                >
                  <div style={numeralStyle}>{numeral}</div>
                  {text}
                </div>
              </>
            ) : (
              <>
                <div style={{ ...numeralStyle, paddingBottom: px(ctx, SPACE_U) }}>{numeral}</div>
                {rule}
                <div style={{ paddingTop: px(ctx, SPACE_U) }}>{text}</div>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
