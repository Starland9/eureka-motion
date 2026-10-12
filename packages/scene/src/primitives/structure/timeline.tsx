import type { PrimitiveProps } from "../../composition/context";
import {
  colourOf,
  fontOf,
  Highlighted,
  highlightTextColour,
  px,
  strokeWidth,
  textSize,
} from "../shared";
import { typeScale } from "../../tokens";
import { clamp01, fadeOf, partId, proseSize, sequenced } from "./motion";

const COLUMN_GAP_U = 2;
const TICK_U = 3;
const SPACE_U = 1.5;
const DETAIL_GAP_U = 0.75;

export function TimelinePrimitive({ element, ctx }: PrimitiveProps<"timeline">) {
  const count = element.events.length;
  const whole = ctx.state.of(element.id);
  const labels = element.events.map((event) => event.label);
  const labelSize = textSize(
    ctx,
    proseSize(ctx, labels, ctx.size.width / count - px(ctx, COLUMN_GAP_U)),
  );
  const ink = colourOf(ctx, "ink");
  const line = strokeWidth(ctx, "regular");

  return (
    <div
      lang={ctx.language}
      style={{
        flex: "1 1 0",
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        gridTemplateRows: "auto auto auto",
        alignContent: "center",
      }}
    >
      <div
        aria-hidden
        data-role="line"
        style={{
          gridColumn: "1 / -1",
          gridRow: 2,
          alignSelf: "center",
          height: line,
          backgroundColor: ink,
          transformOrigin: "left center",
          transform: `scaleX(${whole.how === "draw" ? whole.progress : 1})`,
          opacity: fadeOf(whole),
        }}
      />
      <ol
        style={{
          gridColumn: "1 / -1",
          gridRow: "1 / -1",
          display: "grid",
          gridTemplateColumns: "subgrid",
          gridTemplateRows: "subgrid",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {element.events.map((event, index) => {
          const part = partId("e", index);
          const state = ctx.state.of(`${element.id}.${part}`);
          const step = sequenced(state, whole, index, count);
          const opacity =
            state.how === "draw" ? step.opacity * clamp01(step.trace * 2) : step.opacity;
          return (
            <li
              key={part}
              data-part={part}
              style={{
                gridColumn: index + 1,
                gridRow: "1 / -1",
                display: "grid",
                gridTemplateRows: "subgrid",
                minWidth: 0,
                paddingRight: px(ctx, COLUMN_GAP_U),
                opacity,
                overflowWrap: "anywhere",
              }}
            >
              <div
                style={{
                  gridRow: 1,
                  alignSelf: "end",
                  paddingBottom: px(ctx, SPACE_U),
                  fontFamily: fontOf("mono"),
                  fontWeight: typeScale.caption.weight,
                  fontSize: textSize(ctx, "label"),
                  lineHeight: 1.25,
                  letterSpacing: `${typeScale.caption.tracking}em`,
                  textTransform: "uppercase",
                  color: colourOf(ctx, "ink"),
                }}
              >
                {event.at}
              </div>
              <div
                aria-hidden
                data-role="tick"
                style={{ gridRow: 2, width: line, height: px(ctx, TICK_U), backgroundColor: ink }}
              />
              <div style={{ gridRow: 3, paddingTop: px(ctx, SPACE_U) }}>
                <div
                  style={{
                    fontFamily: fontOf("text"),
                    fontWeight: 600,
                    fontSize: labelSize,
                    lineHeight: 1.2,
                    color: highlightTextColour(ctx, state, ink),
                  }}
                >
                  <Highlighted ctx={ctx} state={state}>
                    {event.label}
                  </Highlighted>
                </div>
                {event.detail ? (
                  <div
                    style={{
                      marginTop: px(ctx, DETAIL_GAP_U),
                      fontFamily: fontOf("text"),
                      fontSize: textSize(ctx, "min"),
                      lineHeight: 1.3,
                      color: colourOf(ctx, "inkSoft"),
                    }}
                  >
                    {event.detail}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
