import type { ReactNode } from "react";
import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { resolve, type Bindable } from "../../expr";
import { Pictogram } from "../../pictograms";
import type { ElementOf } from "../../schema/document";
import { labelColour, labelText } from "../figure/b-label";
import { colourOf, drawStyle, FigureLabel, strokeWidth, SvgHighlight } from "../shared";
import { fadeOf } from "../structure/motion";
import {
  flowLayout,
  flowOutline,
  flowRatios,
  type BranchGeometry,
  type NodeGeometry,
} from "./flow-layout";
import { ratioOf } from "./two-body-layout";

const HIGHLIGHT_PAD_U = 0.5;

interface BranchProps {
  ctx: SceneContext;
  state: ElementState;
  geometry: BranchGeometry;
  role: ElementOf<"sim.flow">["inputs"][number]["role"];
  lineHeight: number;
  part: string;
}

function Branch({ ctx, state, geometry, role, lineHeight, part }: BranchProps) {
  const opacity = fadeOf(state);
  const outline = flowOutline(geometry, state.how === "draw" ? state.progress : 1);
  const pad = HIGHLIGHT_PAD_U * ctx.u;
  return (
    <g data-part={part}>
      <g opacity={state.opacity}>
        <SvgHighlight
          ctx={ctx}
          state={state}
          x={geometry.from - pad}
          y={geometry.zoneTop}
          width={geometry.to - geometry.from + 2 * pad}
          height={geometry.zoneHeight}
        />
      </g>
      <line
        x1={geometry.from}
        y1={geometry.y}
        x2={geometry.to}
        y2={geometry.y}
        stroke={ctx.theme.rule}
        strokeWidth={strokeWidth(ctx, "construction")}
        opacity={opacity}
      />
      {outline ? (
        <polygon
          points={outline.map(([x, y]) => `${x},${y}`).join(" ")}
          fill={colourOf(ctx, role ?? "action")}
          opacity={opacity}
        />
      ) : null}
      {geometry.lines.map((line, index) => (
        <FigureLabel
          key={index}
          ctx={ctx}
          state={state}
          x={geometry.labelX}
          y={geometry.labelY + index * lineHeight}
          anchor={geometry.anchor}
          text={labelText(line)}
          colour={labelColour(role, "action")}
        />
      ))}
    </g>
  );
}

interface NodeProps {
  ctx: SceneContext;
  state: ElementState;
  geometry: NodeGeometry;
  object: ElementOf<"sim.flow">["node"]["object"];
  lineHeight: number;
}

function Node({ ctx, state, geometry, object, lineHeight }: NodeProps) {
  const { x, y, width, height, icon } = geometry;
  const pad = HIGHLIGHT_PAD_U * ctx.u;
  const drawn = state.how === "draw";
  return (
    <g data-part="node">
      <g opacity={state.opacity}>
        <SvgHighlight
          ctx={ctx}
          state={state}
          x={x - pad}
          y={y - pad}
          width={width + 2 * pad}
          height={height + 2 * pad}
        />
      </g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={colourOf(ctx, "ink")}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, 2 * (width + height))}
      />
      {object && icon.size > 0 ? (
        <Pictogram
          ctx={ctx}
          kind={object}
          x={icon.x}
          y={icon.y}
          size={icon.size}
          opacity={drawn ? state.opacity * state.progress : fadeOf(state)}
        />
      ) : null}
      {geometry.lines.map((line, index) => (
        <FigureLabel
          key={index}
          ctx={ctx}
          state={state}
          x={geometry.labelX}
          y={geometry.labelY + index * lineHeight}
          text={labelText(line)}
        />
      ))}
    </g>
  );
}

export function FlowSim({ element, ctx }: PrimitiveProps<"sim.flow">) {
  const ratio = (value: Bindable): number =>
    ratioOf(resolve(value, ctx.scope), resolve(value, ctx.refScope));
  const rates = flowRatios(
    element.inputs.map((branch) => ratio(branch.rate)),
    element.outputs.map((branch) => ratio(branch.rate)),
  );
  const geometry = flowLayout(ctx.size, ctx.u, {
    node: element.node.label,
    inputs: element.inputs.map((branch, i) => ({
      label: branch.label,
      ratio: rates.inputs[i] as number,
    })),
    outputs: element.outputs.map((branch, i) => ({
      label: branch.label,
      ratio: rates.outputs[i] as number,
    })),
  });
  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const node = part("node");

  const branches = (
    items: ElementOf<"sim.flow">["inputs"],
    shapes: BranchGeometry[],
  ): ReactNode[] =>
    items.map((item, i) => {
      const state = part(item.id);
      return state.visible ? (
        <Branch
          key={item.id}
          ctx={ctx}
          state={state}
          geometry={shapes[i] as BranchGeometry}
          role={item.role}
          lineHeight={geometry.lineHeight}
          part={item.id}
        />
      ) : null;
    });

  return (
    <g>
      {branches(element.inputs, geometry.inputs)}
      {branches(element.outputs, geometry.outputs)}
      {node.visible ? (
        <Node
          ctx={ctx}
          state={node}
          geometry={geometry.node}
          object={element.node.object}
          lineHeight={geometry.lineHeight}
        />
      ) : null}
    </g>
  );
}
