import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementOf } from "../../schema/document";
import { formatNumberParts } from "../../expr";
import { monoSafe } from "../../tokens";
import { fontOf, Highlighted, highlightTextColour, px } from "../shared";
import {
  COLUMN_GAP_U,
  LABEL_LINE,
  measureReadout,
  PAD_U,
  planReadouts,
  VALUE_LINE,
  widestValue,
  type ReadoutPlan,
  type ReadoutSpec,
} from "./readout-fit";

function specOf(element: ElementOf<"readout">, ctx: SceneContext): ReadoutSpec {
  const info = ctx.valueInfo(element.value);
  // The widest of the current and the reference value: a slider does not reshuffle the slot.
  const values = [ctx.scope, ctx.refScope].map((scope) =>
    formatNumberParts(scope[element.value] ?? Number.NaN, info?.format, ctx.language),
  );
  return {
    label: element.label ?? info?.label ?? element.value,
    ...widestValue(values),
    unitChars: info ? monoSafe(info.unit).length : 0,
  };
}

// The readouts of a slot share one plan: stacked when they all fit, then label and value on a
// line, then smaller, so that none of them runs past the slot.
function planOf(ctx: SceneContext): ReadoutPlan {
  const specs: ReadoutSpec[] = [];
  for (const element of ctx.lookup.values()) {
    if (element.type === "readout" && element.slot === ctx.slot) specs.push(specOf(element, ctx));
  }
  return planReadouts(specs, { ...ctx.size, u: ctx.u });
}

export function readoutHeight(
  element: ElementOf<"readout">,
  ctx: SceneContext,
  width = ctx.size.width,
): number {
  return measureReadout(specOf(element, ctx), planOf(ctx), { width, u: ctx.u }).height;
}

export function ReadoutPrimitive({ element, ctx }: PrimitiveProps<"readout">) {
  const state = ctx.state.of(element.id);
  const info = ctx.valueInfo(element.value);
  const parts = formatNumberParts(
    ctx.scope[element.value] ?? Number.NaN,
    info?.format,
    ctx.language,
  );
  const plan = planOf(ctx);
  const { labelSize, valueSize, stacked } = plan;
  const { row } = measureReadout(specOf(element, ctx), plan, { width: ctx.size.width, u: ctx.u });
  const unit = info ? monoSafe(info.unit) : "";
  const soft = highlightTextColour(ctx, state, ctx.theme.inkSoft);
  return (
    <div lang={ctx.language} style={{ opacity: state.opacity, fontFamily: fontOf("mono") }}>
      <Highlighted ctx={ctx} state={state} style={{ display: stacked ? "inline-block" : "block" }}>
        <span
          style={{
            display: "flex",
            flexDirection: row ? "row" : "column",
            flexWrap: "wrap",
            alignItems: row ? "baseline" : "flex-start",
            justifyContent: "space-between",
            columnGap: px(ctx, COLUMN_GAP_U),
            padding: `${px(ctx, PAD_U)}px 0`,
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
