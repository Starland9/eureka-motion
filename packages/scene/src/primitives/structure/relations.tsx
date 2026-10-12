import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import type { ElementOf } from "../../schema/document";
import { contrastRatio } from "../../tokens";
import {
  ARROW_HEAD_U,
  ArrowHead,
  colourOf,
  drawStyle,
  FigureLabel,
  fontOf,
  highlightTextColour,
  labelOpacity,
  labelRise,
  strokeWidth,
  SvgHighlight,
  textSize,
} from "../shared";
import { clamp01, fadeOf } from "./motion";
import { layoutRelations, type NodeBox } from "./relations-layout";

const NODE_PHASE = 0.4;
const HEAD_FROM = 0.85;

function nodeOpacity(state: ElementState): number {
  return state.how === "draw"
    ? state.opacity * clamp01(state.progress / NODE_PHASE)
    : fadeOf(state);
}

function edgeStateOf(a: ElementState, b: ElementState): ElementState {
  if (a.how === "draw" && b.how === "draw") {
    const progress = clamp01((Math.min(a.progress, b.progress) - NODE_PHASE) / (1 - NODE_PHASE));
    return { ...a, progress, opacity: progress > 0 ? Math.min(a.opacity, b.opacity) : 0 };
  }
  return { ...a, how: "fade", progress: 1, opacity: Math.min(fadeOf(a), fadeOf(b)) };
}

function readableOn(ctx: SceneContext, fill: string): string {
  const { ink, surfaceRaised } = ctx.theme;
  return contrastRatio(fill, ink) >= contrastRatio(fill, surfaceRaised) ? ink : surfaceRaised;
}

function nodeColours(
  ctx: SceneContext,
  role: ElementOf<"relations">["nodes"][number]["role"],
): { fill: string; text: string } {
  if (role && role !== "ink" && role !== "inkSoft") {
    const fill = colourOf(ctx, role);
    return { fill, text: readableOn(ctx, fill) };
  }
  return { fill: ctx.theme.surfaceRaised, text: colourOf(ctx, role === "inkSoft" ? role : "ink") };
}

function NodeView({
  ctx,
  box,
  state,
  role,
  size,
  lineHeight,
}: {
  ctx: SceneContext;
  box: NodeBox;
  state: ElementState;
  role: ElementOf<"relations">["nodes"][number]["role"];
  size: number;
  lineHeight: number;
}) {
  const opacity = nodeOpacity(state);
  if (opacity <= 0) return null;
  const { fill, text } = nodeColours(ctx, role);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return (
    <g data-node={box.id} opacity={opacity}>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} fill={fill} />
      <SvgHighlight
        ctx={ctx}
        state={state}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
      />
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke={colourOf(ctx, "ink")}
        strokeWidth={strokeWidth(ctx, "regular")}
      />
      {box.lines.map((line, index) => (
        <text
          key={index}
          x={cx}
          y={cy + (index - (box.lines.length - 1) / 2) * size * lineHeight}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={fontOf("text")}
          fontWeight={600}
          fontSize={size}
          fill={highlightTextColour(ctx, state, text)}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

export function RelationsPrimitive({ element, ctx }: PrimitiveProps<"relations">) {
  const stroke = strokeWidth(ctx, "regular");
  const layout = layoutRelations({
    nodes: element.nodes,
    edges: element.edges,
    width: ctx.size.width,
    height: ctx.size.height,
    u: ctx.u,
    inset: stroke / 2,
    sizes: {
      body: textSize(ctx, "body"),
      min: textSize(ctx, "min"),
      label: textSize(ctx, "label"),
    },
    headSize: ARROW_HEAD_U * ctx.u,
  });
  const states = new Map(
    element.nodes.map((node) => [node.id, ctx.state.of(`${element.id}.${node.id}`)] as const),
  );
  const ink = colourOf(ctx, "ink");

  return (
    <g>
      {layout.edges.map((edge) => {
        const a = states.get(edge.from);
        const b = states.get(edge.to);
        if (!a || !b) return null;
        const state = edgeStateOf(a, b);
        if (state.opacity <= 0) return null;
        const head =
          state.how === "draw" ? clamp01((state.progress - HEAD_FROM) / (1 - HEAD_FROM)) : 1;
        const plateOpacity = labelOpacity(state);
        return (
          <g key={`${edge.from}>${edge.to}`} data-edge={`${edge.from}>${edge.to}`}>
            <g opacity={state.opacity}>
              <line
                x1={edge.start[0]}
                y1={edge.start[1]}
                x2={edge.shaftEnd[0]}
                y2={edge.shaftEnd[1]}
                stroke={ink}
                strokeWidth={stroke}
                {...drawStyle(state, edge.length)}
              />
              <ArrowHead ctx={ctx} tip={edge.tip} from={edge.start} colour={ink} opacity={head} />
            </g>
            {edge.label ? (
              <>
                <rect
                  x={edge.mid[0] - edge.plate.width / 2}
                  y={edge.mid[1] - edge.plate.height / 2 + labelRise(ctx, state)}
                  width={edge.plate.width}
                  height={edge.plate.height}
                  fill={ctx.theme.surfaceRaised}
                  opacity={plateOpacity}
                />
                <FigureLabel
                  ctx={ctx}
                  state={state}
                  x={edge.mid[0]}
                  y={edge.mid[1]}
                  text={edge.label}
                />
              </>
            ) : null}
          </g>
        );
      })}
      {layout.nodes.map((box) => {
        const node = element.nodes.find((candidate) => candidate.id === box.id);
        const state = states.get(box.id);
        if (!node || !state) return null;
        return (
          <NodeView
            key={box.id}
            ctx={ctx}
            box={box}
            state={state}
            role={node.role}
            size={layout.textSize}
            lineHeight={layout.lineHeight}
          />
        );
      })}
    </g>
  );
}
