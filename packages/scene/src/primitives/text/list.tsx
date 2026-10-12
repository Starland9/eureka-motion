import type { PrimitiveProps } from "../../composition/context";
import { fontOf, Highlighted, highlightTextColour, textSize } from "../shared";
import { BLOCK_GAP_EM, LINE_HEIGHT, numeralColumn, readingSize } from "./support";

export function ListPrimitive({ element, ctx }: PrimitiveProps<"list">) {
  const state = ctx.state.of(element.id);
  const numeralSize = textSize(ctx, "label");
  const column = numeralColumn(ctx);
  const size = readingSize(ctx);
  const count = element.items.length;
  const typing = state.how === "type";
  return (
    <div
      lang={ctx.language}
      style={{
        opacity: state.opacity,
        display: "flex",
        flexDirection: "column",
        gap: size * BLOCK_GAP_EM,
        fontFamily: fontOf("text"),
        fontSize: size,
        lineHeight: LINE_HEIGHT,
        textWrap: "pretty",
        color: highlightTextColour(ctx, state, ctx.theme.ink),
      }}
    >
      {element.items.map((item, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            alignItems: "baseline",
            opacity: typing ? Math.min(1, Math.max(0, state.progress * count - index)) : 1,
          }}
        >
          <span
            style={{
              flex: "none",
              width: column,
              fontFamily: fontOf("mono"),
              fontSize: numeralSize,
              fontVariantNumeric: "tabular-nums",
              color: highlightTextColour(ctx, state, ctx.theme.inkFaint),
            }}
          >
            {index + 1}
          </span>
          <Highlighted ctx={ctx} state={state} style={{ minWidth: 0 }}>
            {item}
          </Highlighted>
        </div>
      ))}
    </div>
  );
}
