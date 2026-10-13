import katex from "katex";
import type { PrimitiveProps, SceneContext } from "../../composition/context";
import { KATEX_OPTIONS, roleMacros } from "../../schema/tex";
import { Highlighted, highlightTextColour, px, textSize } from "../shared";
import { katexHeightEm, texSource } from "./tex";

const NOTES_UNITS = 5;
const CLIP_OVERSHOOT_EM = 0.25;
// Glyphs of tall formulas overshoot their struts a little.
const HEIGHT_MARGIN = 0.9;

const PLAIN_HEIGHT_EM = 1.5;
const FRACTION_HEIGHT_EM = 2.7;

export function formulaHeight(tex: string, ctx: SceneContext): number {
  const size = ctx.slot === "formula" ? textSize(ctx, "formula") : px(ctx, NOTES_UNITS);
  return size * (/\\d?frac/.test(tex) ? FRACTION_HEIGHT_EM : PLAIN_HEIGHT_EM);
}

export function FormulaPrimitive({ element, ctx }: PrimitiveProps<"formula">) {
  const state = ctx.state.of(element.id);
  const html = katex.renderToString(texSource(element.tex, ctx), {
    ...KATEX_OPTIONS,
    displayMode: true,
    macros: roleMacros(ctx.theme.role),
  });
  const centred = ctx.slot === "formula";
  const size = Math.min(
    centred ? textSize(ctx, "formula") : px(ctx, NOTES_UNITS),
    (ctx.size.height * HEIGHT_MARGIN) / katexHeightEm(html),
  );
  const revealed = state.how === "type" && state.progress < 1;
  return (
    <div
      style={{
        opacity: state.opacity,
        display: "flex",
        justifyContent: centred ? "center" : "flex-start",
        fontSize: size,
        color: highlightTextColour(ctx, state, ctx.theme.ink),
      }}
    >
      <Highlighted ctx={ctx} state={state}>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            // Cancels the 1em margin that .katex-display carries.
            margin: `${-size}px 0`,
            clipPath: revealed
              ? `inset(0 ${(1 - state.progress) * 100}% 0 ${-CLIP_OVERSHOOT_EM * size}px)`
              : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Highlighted>
    </div>
  );
}
