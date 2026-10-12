import type { LayoutName, SlotName } from "../schema/document";
import { SLOT_GUTTER_U, type Frame, type Rect } from "./frame";

export type SlotRects = Partial<Record<SlotName, Rect>>;

const FIGURE_WIDTH_U = 68;
const STATEMENT_WIDTH_U = 84;
const FORMULA_HEIGHT_U = 14;
const COMPARE_WIDTH_U = 52;

export function layoutSlots(layout: LayoutName, frame: Frame): SlotRects {
  const { body, u } = frame;
  const gutter = SLOT_GUTTER_U * u;
  const figureWidth = FIGURE_WIDTH_U * u;
  const sideX = body.x + figureWidth + gutter;
  const sideWidth = body.width - figureWidth - gutter;

  switch (layout) {
    case "statement":
      return { text: { ...body, width: STATEMENT_WIDTH_U * u } };
    case "figure":
      return { figure: body };
    case "figure-notes":
      return {
        figure: { ...body, width: figureWidth },
        notes: { ...body, x: sideX, width: sideWidth },
      };
    case "formula-focus": {
      const formulaHeight = FORMULA_HEIGHT_U * u;
      const top = body.y + formulaHeight + gutter / 2;
      const height = body.height - formulaHeight - gutter / 2;
      return {
        formula: { ...body, height: formulaHeight },
        figure: { x: body.x, y: top, width: figureWidth, height },
        readout: { x: sideX, y: top, width: sideWidth, height },
      };
    }
    case "compare": {
      const width = COMPARE_WIDTH_U * u;
      return {
        figure_a: { ...body, width },
        figure_b: { ...body, x: body.x + width + gutter, width },
      };
    }
    case "sequence":
      return { track: body };
  }
}
