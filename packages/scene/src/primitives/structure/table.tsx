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
import { proseSize, sequenced } from "./motion";

const CELL_GAP_U = 2;
const CELL_PAD_U = 1.1;

export function TablePrimitive({ element, ctx }: PrimitiveProps<"table">) {
  const state = ctx.state.of(element.id);
  const { trace, caption, opacity } = sequenced(state, state, 0, 1);
  const count = element.columns.length;
  const bodySize = textSize(
    ctx,
    proseSize(ctx, element.rows.flat(), ctx.size.width / count - px(ctx, CELL_GAP_U)),
  );
  const ink = colourOf(ctx, "ink");
  const text = highlightTextColour(ctx, state, ink);

  const cell = (header: boolean, last: boolean): CSSProperties => ({
    padding: `${px(ctx, CELL_PAD_U)}px ${last ? 0 : px(ctx, CELL_GAP_U)}px ${px(ctx, CELL_PAD_U)}px 0`,
    textAlign: "left",
    verticalAlign: header ? "bottom" : "top",
    opacity: caption,
  });

  const ruleRow = (key: string, thickness: number, colour: string) => (
    <tr key={key} aria-hidden data-role="rule">
      <td colSpan={count} style={{ padding: 0, height: thickness, lineHeight: 0 }}>
        <div
          style={{
            height: thickness,
            backgroundColor: colour,
            transformOrigin: "left center",
            transform: `scaleX(${trace})`,
          }}
        />
      </td>
    </tr>
  );

  return (
    <table
      lang={ctx.language}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        borderSpacing: 0,
        opacity,
        overflowWrap: "break-word",
      }}
    >
      <thead>
        <tr>
          {element.columns.map((column, index) => (
            <th
              key={index}
              scope="col"
              style={{
                ...cell(true, index === count - 1),
                fontFamily: fontOf("mono"),
                fontWeight: typeScale.caption.weight,
                fontSize: textSize(ctx, "label"),
                lineHeight: 1.25,
                letterSpacing: `${typeScale.caption.tracking}em`,
                textTransform: "uppercase",
                color: text,
              }}
            >
              <Highlighted ctx={ctx} state={state}>
                {column}
              </Highlighted>
            </th>
          ))}
        </tr>
        {ruleRow("head", strokeWidth(ctx, "regular"), ink)}
      </thead>
      <tbody>
        {element.rows.flatMap((row, rowIndex) => [
          <tr key={`r${rowIndex}`}>
            {row.map((value, index) => (
              <td
                key={index}
                style={{
                  ...cell(false, index === count - 1),
                  fontFamily: fontOf("text"),
                  fontWeight: index === 0 ? 600 : 400,
                  fontSize: bodySize,
                  lineHeight: 1.25,
                  color: text,
                }}
              >
                <Highlighted ctx={ctx} state={state}>
                  {value}
                </Highlighted>
              </td>
            ))}
          </tr>,
          ruleRow(`l${rowIndex}`, strokeWidth(ctx, "construction"), ctx.theme.rule),
        ])}
      </tbody>
    </table>
  );
}
