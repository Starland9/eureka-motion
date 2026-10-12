import type { PrimitiveProps, SceneContext } from "../../composition/context";
import { formatNumberParts } from "../../expr";
import { monoSafe } from "../../tokens";
import { fontOf, Highlighted, highlightTextColour, px, textSize } from "../shared";

const VALUE_UNITS = 6;
const UNIT_ALLOWANCE_UNITS = 4;
const LABEL_LINE = 1.25;
const VALUE_LINE = 1.15;
const PAD_UNITS = 0.3;
// Gap that SceneFrame leaves between the html elements of a slot.
const SLOT_GAP_UNITS = 2.5;
// "1,98 × 10⁻²⁰" in IBM Plex Mono, with the exponent set at 0.6 em.
const WIDEST_VALUE_EM = 6.5;

// The readouts of a slot all stack their label above the value, or none does: when they do
// not fit the slot together, label and value share a line and the value drops to the body size.
function layoutOf(ctx: SceneContext): { valueSize: number; row: boolean } {
  const stacked = Math.min(
    px(ctx, VALUE_UNITS),
    (ctx.size.width - px(ctx, UNIT_ALLOWANCE_UNITS)) / WIDEST_VALUE_EM,
  );
  let count = 0;
  for (const element of ctx.lookup.values()) {
    if (element.type === "readout" && element.slot === ctx.slot) count += 1;
  }
  const each = textSize(ctx, "label") * LABEL_LINE + stacked * VALUE_LINE + 2 * px(ctx, PAD_UNITS);
  const total = count * each + (count - 1) * px(ctx, SLOT_GAP_UNITS);
  return total <= ctx.size.height
    ? { valueSize: stacked, row: false }
    : { valueSize: textSize(ctx, "body"), row: true };
}

export function ReadoutPrimitive({ element, ctx }: PrimitiveProps<"readout">) {
  const state = ctx.state.of(element.id);
  const info = ctx.valueInfo(element.value);
  const parts = formatNumberParts(
    ctx.scope[element.value] ?? Number.NaN,
    info?.format,
    ctx.language,
  );
  const labelSize = textSize(ctx, "label");
  const { valueSize, row } = layoutOf(ctx);
  const unit = info ? monoSafe(info.unit) : "";
  const soft = highlightTextColour(ctx, state, ctx.theme.inkSoft);
  return (
    <div lang={ctx.language} style={{ opacity: state.opacity, fontFamily: fontOf("mono") }}>
      <Highlighted ctx={ctx} state={state} style={{ display: "block" }}>
        <span
          style={{
            display: "flex",
            flexDirection: row ? "row" : "column",
            flexWrap: "wrap",
            alignItems: row ? "baseline" : "flex-start",
            justifyContent: "space-between",
            columnGap: px(ctx, 2),
            padding: `${px(ctx, PAD_UNITS)}px 0`,
          }}
        >
          <span
            style={{
              fontSize: labelSize,
              fontWeight: 500,
              lineHeight: LABEL_LINE,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: highlightTextColour(ctx, state, ctx.theme.inkFaint),
            }}
          >
            {element.label ?? info?.label ?? element.value}
          </span>
          <span
            style={{
              fontSize: valueSize,
              lineHeight: VALUE_LINE,
              fontVariantNumeric: "tabular-nums",
              color: highlightTextColour(ctx, state, ctx.theme.ink),
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>
              {parts.mantissa}
              {parts.exponent === null ? null : (
                <>
                  {" × 10"}
                  <sup
                    style={{
                      fontSize: "0.6em",
                      lineHeight: 0,
                      verticalAlign: "baseline",
                      position: "relative",
                      top: "-0.55em",
                    }}
                  >
                    {String(parts.exponent).replace("-", "−")}
                  </sup>
                </>
              )}
              {parts.suffix}
            </span>
            {unit === "" ? null : (
              <span style={{ fontSize: labelSize, color: soft }}>
                {" "}
                <span style={{ whiteSpace: "nowrap" }}>{unit}</span>
              </span>
            )}
          </span>
        </span>
      </Highlighted>
    </div>
  );
}
