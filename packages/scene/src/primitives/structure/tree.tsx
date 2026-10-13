import type { PrimitiveProps, SceneContext } from "../../composition/context";
import { DIM_OPACITY, type ElementState } from "../../composition/state";
import { monoSafe, typeScale } from "../../tokens";
import { HighlightBand } from "../figure/b-band";
import { labelText } from "../figure/b-label";
import {
  colourOf,
  drawStyle,
  FigureLabel,
  fontOf,
  highlightTextColour,
  labelOpacity,
  px,
  strokeOf,
  strokeWidth,
  textSize,
} from "../shared";
import { clamp01, fadeOf } from "./motion";
import { layoutTree, type TreeNodeBox } from "./tree-layout";

const EDGE_PHASE = 0.55;
const VALUE_SIZE_U = 6;

interface NodeView {
  node: ElementState;
  edge: ElementState;
}

function viewOf(
  raw: ElementState,
  box: TreeNodeBox,
  depth: number,
  staggered: boolean,
  root: boolean,
): NodeView {
  if (raw.how !== "draw") {
    const shown: ElementState = { ...raw, opacity: fadeOf(raw), how: "fade" };
    return { node: shown, edge: shown };
  }
  const progress = staggered ? clamp01(raw.progress * depth - box.level) : raw.progress;
  const edge = root ? 1 : clamp01(progress / EDGE_PHASE);
  const body = root ? progress : clamp01((progress - EDGE_PHASE) / (1 - EDGE_PHASE));
  return {
    node: { ...raw, progress: body, opacity: body > 0 ? raw.opacity : 0 },
    edge: { ...raw, progress: edge, opacity: edge > 0 ? raw.opacity : 0 },
  };
}

function partOpacity(state: ElementState): number {
  const own = state.how === "draw" ? labelOpacity(state) : fadeOf(state);
  return own / (1 - (1 - DIM_OPACITY) * state.dim);
}

function valueOpacityOf(leaf: boolean, node: ElementState, part: ElementState): number {
  if (leaf) return labelOpacity(node);
  return part.visible ? Math.min(labelOpacity(node), partOpacity(part)) : 0;
}

function Caption({
  ctx,
  lines,
  x,
  y,
  size,
  lineHeight,
  level,
  opacity,
}: {
  ctx: SceneContext;
  lines: readonly string[];
  x: number;
  y: number;
  size: number;
  lineHeight: number;
  level: number;
  opacity: number;
}) {
  return (
    <g data-level={level} opacity={opacity}>
      {lines.map((line, row) => (
        <text
          key={row}
          x={x}
          y={y + row * size * lineHeight}
          dominantBaseline="middle"
          fontFamily={fontOf("mono")}
          fontWeight={typeScale.caption.weight}
          fontSize={size}
          letterSpacing={`${typeScale.caption.tracking}em`}
          fill={colourOf(ctx, "inkSoft")}
        >
          {monoSafe(line).toUpperCase()}
        </text>
      ))}
    </g>
  );
}

export function TreePrimitive({ element, ctx }: PrimitiveProps<"tree">) {
  const stroke = strokeWidth(ctx, "regular");
  const layout = layoutTree({
    nodes: element.nodes,
    levels: element.levels ?? [],
    width: ctx.size.width,
    height: ctx.size.height,
    u: ctx.u,
    stroke,
    sizes: {
      min: textSize(ctx, "min"),
      label: textSize(ctx, "label"),
      value: px(ctx, VALUE_SIZE_U),
    },
  });
  const whole = ctx.state.of(element.id);
  const staggered = whole.how === "draw";
  const ink = colourOf(ctx, "ink");
  const { radius } = layout;

  const declared = new Map(element.nodes.map((node) => [node.id, node]));
  const raws = new Map<string, ElementState>();
  const valueStates = new Map<string, ElementState>();
  const views = new Map<string, NodeView>();
  for (const box of layout.nodes) {
    const raw = ctx.state.of(`${element.id}.${box.id}`);
    raws.set(box.id, raw);
    valueStates.set(box.id, ctx.state.of(`${element.id}.${box.id}_value`));
    views.set(box.id, viewOf(raw, box, layout.depth, staggered, box.parent === undefined));
  }
  const lit = (id: string): number =>
    Math.max(raws.get(id)?.highlight ?? 0, valueStates.get(id)?.highlight ?? 0);

  return (
    <g>
      {layout.captions.map(({ level, block }) => {
        const opacity = Math.max(
          0,
          ...layout.nodes
            .filter((box) => box.level === level)
            .map((box) => labelOpacity(views.get(box.id)?.node as ElementState)),
        );
        return opacity > 0 ? (
          <Caption
            key={level}
            ctx={ctx}
            lines={block.lines}
            x={block.x}
            y={block.y}
            size={layout.labelSize}
            lineHeight={layout.captionLineHeight}
            level={level}
            opacity={opacity}
          />
        ) : null;
      })}
      {layout.edges.map((edge) => {
        const child = views.get(edge.child);
        const parent = raws.get(edge.parent);
        if (!child || !parent) return null;
        const state: ElementState = {
          ...child.edge,
          opacity: Math.min(child.edge.opacity, fadeOf(parent)),
          highlight: Math.min(lit(edge.parent), lit(edge.child)),
        };
        if (state.opacity <= 0) return null;
        const width = stroke + (strokeWidth(ctx, "accent") - stroke) * state.highlight;
        return (
          <g key={`${edge.parent}>${edge.child}`} data-edge={`${edge.parent}>${edge.child}`}>
            <g opacity={state.opacity}>
              <HighlightBand ctx={ctx} state={state} from={edge.start} to={edge.end} />
              <line
                x1={edge.start[0]}
                y1={edge.start[1]}
                x2={edge.end[0]}
                y2={edge.end[1]}
                stroke={ink}
                strokeWidth={width}
                {...drawStyle(state, edge.length)}
              />
            </g>
          </g>
        );
      })}
      {layout.nodes.map((box) => {
        const view = views.get(box.id);
        const declaredNode = declared.get(box.id);
        const valueState = valueStates.get(box.id);
        if (!view || !declaredNode || !valueState || view.node.opacity <= 0) return null;
        const { node } = view;
        const permanent =
          declaredNode.role === "result" ? (node.how === "draw" ? node.progress : 1) : 0;
        const marked = Math.max(lit(box.id), permanent);
        const value = declaredNode.value;
        const valueShown = valueOpacityOf(box.leaf, node, valueState);
        return (
          <g key={box.id}>
            <g data-node={box.id} opacity={node.opacity}>
              <circle
                cx={box.x}
                cy={box.y}
                r={radius}
                fill={ctx.theme.surfaceRaised}
                opacity={node.how === "draw" ? node.progress : 1}
              />
              {marked > 0 ? (
                <circle cx={box.x} cy={box.y} r={radius * marked} fill={ctx.theme.role.result} />
              ) : null}
              <circle
                cx={box.x}
                cy={box.y}
                r={radius}
                fill="none"
                stroke={strokeOf(ctx, declaredNode.role)}
                strokeWidth={stroke}
                transform={`rotate(-90 ${box.x} ${box.y})`}
                {...drawStyle(node, 2 * Math.PI * radius)}
              />
            </g>
            {value && valueShown > 0 ? (
              <text
                data-value={box.id}
                x={box.x}
                y={box.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily={fontOf("mono")}
                fontWeight={500}
                fontSize={layout.valueSize}
                fill={highlightTextColour(ctx, { ...node, highlight: marked }, ink)}
                opacity={valueShown}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {monoSafe(value)}
              </text>
            ) : null}
          </g>
        );
      })}
      {layout.nodes.map((box) => {
        const view = views.get(box.id);
        if (!box.label || !view || view.node.opacity <= 0) return null;
        const { lines, x, y, anchor } = box.label;
        return (
          <g key={box.id} data-label={box.id}>
            {lines.map((line, row) => (
              <FigureLabel
                key={row}
                ctx={ctx}
                state={view.node}
                x={x}
                y={y + row * layout.labelSize * layout.lineHeight}
                text={labelText(line)}
                anchor={anchor}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}
