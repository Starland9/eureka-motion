import type { PrimitiveProps } from "../../composition/context";
import { interpolate } from "../../expr";
import { fontOf, Highlighted, highlightTextColour, typedText } from "../shared";
import { formatsOf, LINE_HEIGHT, readingSize, textColour } from "./support";

export function TextPrimitive({ element, ctx }: PrimitiveProps<"text">) {
  const entrance = ctx.state.of(element.id);
  const state = element.role === "result" ? { ...entrance, highlight: 1 } : entrance;
  const text = interpolate(element.text, ctx.scope, {
    language: ctx.language,
    formats: formatsOf(ctx, element.text),
  });
  const shown = typedText(text, state);
  return (
    <div
      lang={ctx.language}
      style={{
        opacity: state.opacity,
        fontFamily: fontOf("text"),
        fontSize: readingSize(ctx),
        fontWeight: element.emphasis === "strong" ? 600 : 400,
        fontVariantNumeric: element.text.includes("{{") ? "tabular-nums" : undefined,
        lineHeight: LINE_HEIGHT,
        textWrap: "pretty",
        color: highlightTextColour(ctx, state, textColour(ctx, element.role)),
      }}
    >
      <Highlighted ctx={ctx} state={state}>
        <span>{shown}</span>
        <span aria-hidden="true" style={{ color: "transparent" }}>
          {text.slice(shown.length)}
        </span>
      </Highlighted>
    </div>
  );
}
