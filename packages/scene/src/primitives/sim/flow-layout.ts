import { sceneMetrics } from "../../tokens";
import { ARROW_HEAD_U } from "../shared/marks";
import { monoWidth } from "../structure/measure";

type Vec = readonly [number, number];

export interface FlowBranchInput {
  label: string;
  ratio: number;
}

export interface FlowInput {
  node: string;
  inputs: readonly FlowBranchInput[];
  outputs: readonly FlowBranchInput[];
}

export interface BranchGeometry {
  lines: string[];
  anchor: "start" | "end";
  labelX: number;
  labelY: number;
  y: number;
  from: number;
  to: number;
  width: number;
  headLength: number;
  headHalf: number;
  zoneTop: number;
  zoneHeight: number;
}

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  labelX: number;
  labelY: number;
  icon: { x: number; y: number; size: number };
}

export interface FlowGeometry {
  lineHeight: number;
  bandMax: number;
  node: NodeGeometry;
  inputs: BranchGeometry[];
  outputs: BranchGeometry[];
}

const PAD_X_U = 1;
const PAD_Y_U = 0.5;
const NODE_WIDTH = { share: 0.2, min: 10, max: 16 } as const;
const LINE_HEIGHT = 1.1;
const LABEL_GAP_U = 0.3;
const LANE_GAP_U = 0.6;
const NODE_GAP_U = 1;
const BOX_PAD_U = 1;
const FLARE_U = 0.6;
const BAND = { max: 8, min: 0.25, reference: 0.4 } as const;
// Below this a lane cannot hold a readable band; the lanes then overflow the slot.
const MIN_ZONE_U = 1.5;
const HEAD_GROWTH = 0.5;
const HEAD_SHARE_MAX = 0.6;
const ICON_SHARE = 0.6;
const ICON_MIN_U = 3;
const CLEARANCE_U = 1;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// A limiting input caps every output: nothing leaves faster than the scarcest input allows.
export function flowRatios(
  inputs: readonly number[],
  outputs: readonly number[],
): { limiting: number; inputs: number[]; outputs: number[] } {
  const limiting = Math.min(...inputs.map((ratio) => Math.max(0, ratio)));
  return {
    limiting,
    inputs: inputs.map((ratio) => Math.max(0, ratio)),
    outputs: outputs.map((ratio) => Math.min(Math.max(0, ratio), limiting)),
  };
}

export function bandWidth(ratio: number, bandMax: number, u: number): number {
  if (!(ratio > 0)) return 0;
  const floor = Math.min(BAND.min * u, bandMax);
  return clamp(BAND.reference * bandMax * ratio, floor, bandMax);
}

export function wrapMono(text: string, capacity: number): string[] {
  const limit = Math.max(1, Math.floor(capacity));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const chars = [...word];
    if (chars.length > limit) {
      if (current) lines.push(current);
      while (chars.length > limit) lines.push(chars.splice(0, limit).join(""));
      current = chars.join("");
      continue;
    }
    const joined = current ? `${current} ${word}` : word;
    if ([...joined].length <= limit) {
      current = joined;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

export function flowOutline(branch: BranchGeometry, reveal = 1): Vec[] | null {
  const length = (branch.to - branch.from) * clamp(reveal, 0, 1);
  if (branch.width <= 0 || length <= 0) return null;
  const tip = branch.from + length;
  const base = tip - Math.min(branch.headLength, length);
  const half = branch.width / 2;
  return [
    [branch.from, branch.y - half],
    [base, branch.y - half],
    [base, branch.y - branch.headHalf],
    [tip, branch.y],
    [base, branch.y + branch.headHalf],
    [base, branch.y + half],
    [branch.from, branch.y + half],
  ];
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export function flowLayout(
  slot: { width: number; height: number },
  u: number,
  input: FlowInput,
): FlowGeometry {
  const { width, height } = slot;
  const size = sceneMetrics.text.label * u;
  const lineHeight = LINE_HEIGHT * size;
  const charWidth = monoWidth("x", size);
  const padX = PAD_X_U * u;
  const padY = PAD_Y_U * u;

  const nodeWidth = clamp(NODE_WIDTH.share * width, NODE_WIDTH.min * u, NODE_WIDTH.max * u);
  const boxX = (width - nodeWidth) / 2;
  const sideLength = Math.max(0, boxX - padX);
  const inLines = input.inputs.map((b) => wrapMono(b.label, sideLength / charWidth));
  const outLines = input.outputs.map((b) => wrapMono(b.label, sideLength / charWidth));
  const nodeLines = wrapMono(input.node, (width - 2 * padX) / charWidth);

  const count = Math.max(input.inputs.length, input.outputs.length);
  const labelRows = Math.max(1, ...inLines.map((l) => l.length), ...outLines.map((l) => l.length));
  const labelHead = labelRows * lineHeight + LABEL_GAP_U * u;
  const nodeBlock = nodeLines.length * lineHeight;
  const widestNode = Math.max(...nodeLines.map((line) => monoWidth(line, size)));

  function arrange(above: boolean): { geometry: FlowGeometry; clear: boolean } {
    const boxPad = BOX_PAD_U * u;
    const nodeGap = NODE_GAP_U * u;
    const laneGap = LANE_GAP_U * u;
    const labelGap = LABEL_GAP_U * u;
    const extraTop = above ? Math.max(0, nodeBlock + nodeGap - (labelHead - boxPad)) : 0;
    const extraBottom = above ? 0 : nodeGap + nodeBlock;
    const available = height - 2 * padY - extraTop - extraBottom - boxPad;
    const zoneMax = (BAND.max + 2 * FLARE_U) * u;
    const zone = clamp(
      (available - (count - 1) * laneGap) / count - labelHead,
      MIN_ZONE_U * u,
      zoneMax,
    );
    const flare = Math.min(FLARE_U * u, 0.2 * zone);
    const bandMax = zone - 2 * flare;
    const pitch = labelHead + zone + laneGap;
    const stack = (count - 1) * pitch + labelHead + zone;
    const top = Math.max(padY, (height - (extraTop + stack + boxPad + extraBottom)) / 2) + extraTop;

    const boxTop = top + labelHead - boxPad;
    const boxHeight = stack - labelHead + 2 * boxPad;
    const labelBoxes: Box[] = [];

    const place = (
      items: readonly FlowBranchInput[],
      lines: string[][],
      side: "in" | "out",
    ): BranchGeometry[] =>
      items.map((item, k) => {
        const laneTop = top + ((count - items.length) / 2 + k) * pitch;
        const zoneTop = laneTop + labelHead;
        const w = bandWidth(item.ratio, bandMax, u);
        const text = lines[k] as string[];
        const from = side === "in" ? padX : boxX + nodeWidth;
        const to = side === "in" ? boxX : width - padX;
        const reach = Math.max(...text.map((line) => monoWidth(line, size)));
        const block = text.length * lineHeight;
        const centre = zoneTop + zone / 2;
        const headHalf = w / 2 + flare;
        labelBoxes.push({
          left: side === "in" ? padX : width - padX - reach,
          right: side === "in" ? padX + reach : width - padX,
          top: zoneTop - labelGap - block,
          bottom: zoneTop - labelGap,
        });
        return {
          lines: text,
          anchor: side === "in" ? "start" : "end",
          labelX: side === "in" ? padX : width - padX,
          labelY: centre - headHalf - labelGap - block + lineHeight / 2,
          y: centre,
          from,
          to,
          width: w,
          headLength: Math.min(HEAD_SHARE_MAX * (to - from), ARROW_HEAD_U * u + HEAD_GROWTH * w),
          headHalf,
          zoneTop,
          zoneHeight: zone,
        } satisfies BranchGeometry;
      });

    const inputs = place(input.inputs, inLines, "in");
    const outputs = place(input.outputs, outLines, "out");

    const nodeLabelTop = above ? boxTop - nodeGap - nodeBlock : boxTop + boxHeight + nodeGap;
    const clearance = CLEARANCE_U * u;
    const nodeLabelBox: Box = {
      left: (width - widestNode) / 2 - clearance,
      right: (width + widestNode) / 2 + clearance,
      top: nodeLabelTop - clearance / 2,
      bottom: nodeLabelTop + nodeBlock + clearance / 2,
    };
    const iconSize = Math.min(nodeWidth, boxHeight) * ICON_SHARE;

    return {
      clear: !labelBoxes.some((box) => overlap(box, nodeLabelBox)),
      geometry: {
        lineHeight,
        bandMax,
        inputs,
        outputs,
        node: {
          x: boxX,
          y: boxTop,
          width: nodeWidth,
          height: boxHeight,
          lines: nodeLines,
          labelX: width / 2,
          labelY: nodeLabelTop + lineHeight / 2,
          icon: {
            x: width / 2,
            y: boxTop + boxHeight / 2,
            size: iconSize >= ICON_MIN_U * u ? iconSize : 0,
          },
        },
      },
    };
  }

  const above = arrange(true);
  return above.clear ? above.geometry : arrange(false).geometry;
}
