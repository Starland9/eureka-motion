import { typeScale } from "../../tokens";
import { monoWidth } from "./measure";

export type Point = readonly [number, number];

export interface TreeInput {
  nodes: readonly { id: string; parent?: string; label?: string; value?: string }[];
  levels: readonly string[];
  width: number;
  height: number;
  u: number;
  stroke: number;
  sizes: { min: number; label: number; value: number };
}

export interface TextBlock {
  lines: string[];
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

export interface TreeNodeBox {
  id: string;
  parent: string | undefined;
  level: number;
  leaf: boolean;
  x: number;
  y: number;
  label: TextBlock | null;
}

export interface TreeEdge {
  parent: string;
  child: string;
  start: Point;
  end: Point;
  length: number;
}

export interface TreeCaption {
  level: number;
  block: TextBlock;
}

export interface TreeLayout {
  nodes: TreeNodeBox[];
  edges: TreeEdge[];
  captions: TreeCaption[];
  depth: number;
  radius: number;
  valueSize: number;
  labelSize: number;
  lineHeight: number;
  captionLineHeight: number;
}

const MONO_ADVANCE = 0.6;
const DIGIT_HEIGHT = 0.7;
const LINE_HEIGHT = 1.25;
const RADIUS_MAX_U = 6.5;
const RADIUS_COMFORT_U = 4.5;
const PAD_U = 0.5;
const GAP_U = 1.5;
const EDGE_MIN_U = 2;
const CELL_MAX_U = 24;
const LABEL_GAP_U = 1;
const GUTTER_GAP_U = 3;
const GUTTER_SHARE = 0.45;
const CAPTION_LINE_HEIGHT = 1.15;
const CAPTION_GAP_U = 1;
const CAPTION_LINES_MAX = 2;
const MIN_CAPTION_CHARS = 6;
const MIN_LABEL_CHARS = 4;
const CACHE_SIZE = 16;

export function wrapMono(text: string, chars: number): string[] {
  const limit = Math.max(1, Math.floor(chars));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const letters = [...word];
    if (current && [...current].length + 1 + letters.length <= limit) {
      current += ` ${word}`;
      continue;
    }
    if (current) lines.push(current);
    while (letters.length > limit) lines.push(letters.splice(0, limit).join(""));
    current = letters.join("");
  }
  if (current) lines.push(current);
  return lines;
}

const widest = (lines: readonly string[]): number =>
  Math.max(0, ...lines.map((line) => [...line].length));

function valueRadius(chars: number, size: number, pad: number, stroke: number): number {
  if (chars === 0) return 0;
  return (
    Math.hypot((chars * MONO_ADVANCE * size) / 2, (DIGIT_HEIGHT * size) / 2) + pad + stroke / 2
  );
}

function valueSizeFor(radius: number, chars: number, pad: number, stroke: number): number {
  return (radius - pad - stroke / 2) / Math.hypot((chars * MONO_ADVANCE) / 2, DIGIT_HEIGHT / 2);
}

interface Shape {
  order: string[];
  column: Map<string, number>;
  level: Map<string, number>;
  children: Map<string, string[]>;
  leaves: number;
  depth: number;
}

function shapeOf(nodes: TreeInput["nodes"]): Shape {
  const known = new Set(nodes.map((node) => node.id));
  const children = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const roots: string[] = [];
  for (const node of nodes) {
    if (node.parent === undefined || !known.has(node.parent)) roots.push(node.id);
    else if (node.parent !== node.id) children.get(node.parent)?.push(node.id);
  }

  const order: string[] = [];
  const column = new Map<string, number>();
  const level = new Map<string, number>();
  let leaves = 0;
  const place = (id: string, depth: number): void => {
    order.push(id);
    level.set(id, depth);
    const below = (children.get(id) ?? []).filter((child) => !level.has(child));
    if (below.length === 0) {
      column.set(id, leaves++);
      return;
    }
    for (const child of below) place(child, depth + 1);
    const first = column.get(below[0] as string) ?? 0;
    const last = column.get(below.at(-1) as string) ?? 0;
    column.set(id, (first + last) / 2);
  };
  for (const root of roots) place(root, 0);
  return {
    order,
    column,
    level,
    children,
    leaves,
    depth: Math.max(-1, ...level.values()) + 1,
  };
}

function captionGutter(
  captions: readonly string[],
  advance: number,
  room: number,
  maxLines: number,
): { width: number; lines: string[][] } {
  if (captions.length === 0) return { width: 0, lines: [] };
  const longest = Math.max(...captions.map((caption) => [...caption].length));
  const limit = Math.max(MIN_CAPTION_CHARS, Math.floor(room / advance));
  let chars = Math.min(MIN_CAPTION_CHARS, longest);
  while (
    chars < Math.min(longest, limit) &&
    captions.some((caption) => wrapMono(caption, chars).length > maxLines)
  ) {
    chars++;
  }
  const lines = captions.map((caption) => wrapMono(caption, Math.min(chars, limit)));
  return { width: widest(lines.flat()) * advance, lines };
}

function computeLayout(input: TreeInput): TreeLayout {
  const { u, stroke, sizes } = input;
  const inset = stroke / 2;
  const width = input.width - 2 * inset;
  const height = input.height - 2 * inset;
  const shape = shapeOf(input.nodes);
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const lineHeight = LINE_HEIGHT;
  const empty: TreeLayout = {
    nodes: [],
    edges: [],
    captions: [],
    depth: 0,
    radius: 0,
    valueSize: sizes.value,
    labelSize: sizes.label,
    lineHeight,
    captionLineHeight: CAPTION_LINE_HEIGHT,
  };
  if (shape.order.length === 0) return empty;
  const { depth, leaves } = shape;
  const isLeaf = (id: string): boolean => (shape.children.get(id) ?? []).length === 0;
  const labelGap = LABEL_GAP_U * u;
  const labelLineHeight = sizes.label * lineHeight;

  const deepLabelled = shape.order.some(
    (id) => isLeaf(id) && shape.level.get(id) === depth - 1 && byId.get(id)?.label,
  );
  const pitch =
    (height - (deepLabelled ? labelGap + CAPTION_LINES_MAX * labelLineHeight : 0)) / depth;
  const captionLines = Math.min(
    CAPTION_LINES_MAX,
    Math.max(1, Math.floor((pitch - CAPTION_GAP_U * u) / (sizes.label * CAPTION_LINE_HEIGHT))),
  );
  const captionAdvance = (MONO_ADVANCE + typeScale.caption.tracking) * sizes.label;
  const gutter = captionGutter(
    input.levels.slice(0, depth),
    captionAdvance,
    GUTTER_SHARE * width,
    captionLines,
  );
  const left = inset + (gutter.width > 0 ? gutter.width + GUTTER_GAP_U * u : 0);
  const right = inset + width;

  const cell = Math.min((right - left) / leaves, CELL_MAX_U * u);
  const origin = left + (right - left - cell * leaves) / 2;
  const gap = GAP_U * u;
  const charWidth = MONO_ADVANCE * sizes.label;

  const leafChars = Math.max(MIN_LABEL_CHARS, Math.floor((cell - gap) / charWidth));
  const leafLines = new Map<string, string[]>();
  for (const id of shape.order) {
    const label = byId.get(id)?.label;
    if (label && isLeaf(id)) leafLines.set(id, wrapMono(label, leafChars));
  }
  const deepLines = Math.max(
    0,
    ...[...leafLines].filter(([id]) => shape.level.get(id) === depth - 1).map(([, v]) => v.length),
  );
  const reserve = deepLines > 0 ? labelGap + deepLines * labelLineHeight : 0;

  const pad = PAD_U * u;
  const chars = Math.max(0, ...shape.order.map((id) => [...(byId.get(id)?.value ?? "")].length));
  const available = height - reserve;
  const fitsRow = (cell - gap) / 2;
  const fitsColumn = (available - (depth - 1) * EDGE_MIN_U * u) / (2 * depth);
  const needed = valueRadius(chars, sizes.min, pad, stroke);
  const feasible = Math.max(u, Math.min(Math.max(RADIUS_MAX_U * u, needed), fitsRow, fitsColumn));
  const preferred = Math.max(RADIUS_COMFORT_U * u, valueRadius(chars, sizes.value, pad, stroke));
  const radius = Math.min(preferred, feasible);
  const valueSize =
    chars === 0 ? sizes.value : Math.min(sizes.value, valueSizeFor(radius, chars, pad, stroke));

  const step = depth > 1 ? (available - 2 * radius) / (depth - 1) : 0;
  const rowY = (level: number): number =>
    depth > 1 ? inset + radius + level * step : inset + available / 2;

  const placed = shape.order.map((id) => ({
    id,
    level: shape.level.get(id) ?? 0,
    x: origin + ((shape.column.get(id) ?? 0) + 0.5) * cell,
  }));
  const centreOf = new Map(placed.map((node) => [node.id, [node.x, rowY(node.level)] as Point]));

  const labels = new Map<string, TextBlock>();
  for (const [id, lines] of leafLines) {
    const [x, y] = centreOf.get(id) as Point;
    labels.set(id, {
      lines,
      x,
      y: y + radius + labelGap + labelLineHeight / 2,
      anchor: "middle",
    });
  }
  for (let level = 0; level < depth; level++) {
    const row = placed.filter((node) => node.level === level).sort((a, b) => a.x - b.x);
    let taken = left;
    row.forEach((node, i) => {
      const label = byId.get(node.id)?.label;
      if (label && !isLeaf(node.id)) {
        const next = row[i + 1];
        const roomRight = (next ? next.x - radius - gap : right) - (node.x + radius + labelGap);
        const roomLeft = node.x - radius - labelGap - (taken + gap);
        const natural = monoWidth(label, sizes.label);
        const y = (centreOf.get(node.id) as Point)[1];
        if (
          Math.max(roomRight, roomLeft) < Math.min(natural, MIN_LABEL_CHARS * charWidth) &&
          level > 0
        ) {
          const lines = wrapMono(
            label,
            Math.max(MIN_LABEL_CHARS, Math.floor((2 * cell) / charWidth)),
          );
          const half = (widest(lines) * charWidth) / 2;
          labels.set(node.id, {
            lines,
            x: Math.min(Math.max(node.x, left + half), right - half),
            y: y - radius - labelGap - (lines.length - 0.5) * labelLineHeight,
            anchor: "middle",
          });
          taken = node.x + radius;
          return;
        }
        const toRight = natural <= roomRight || roomRight >= roomLeft;
        const room = toRight ? roomRight : roomLeft;
        const lines = wrapMono(label, Math.max(MIN_LABEL_CHARS, Math.floor(room / charWidth)));
        labels.set(node.id, {
          lines,
          x: toRight ? node.x + radius + labelGap : node.x - radius - labelGap,
          y: y - ((lines.length - 1) / 2) * labelLineHeight,
          anchor: toRight ? "start" : "end",
        });
        taken = toRight ? node.x + radius + labelGap + widest(lines) * charWidth : node.x + radius;
      } else {
        taken = node.x + radius;
      }
    });
  }

  const nodes: TreeNodeBox[] = placed.map((node) => {
    const [x, y] = centreOf.get(node.id) as Point;
    return {
      id: node.id,
      parent: byId.get(node.id)?.parent,
      level: node.level,
      leaf: isLeaf(node.id),
      x,
      y,
      label: labels.get(node.id) ?? null,
    };
  });

  const edges: TreeEdge[] = [];
  for (const node of nodes) {
    const from = node.parent === undefined ? undefined : centreOf.get(node.parent);
    if (!from || shape.level.get(node.parent as string) !== node.level - 1) continue;
    const to: Point = [node.x, node.y];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const direction: Point = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    edges.push({
      parent: node.parent as string,
      child: node.id,
      start: [from[0] + direction[0] * radius, from[1] + direction[1] * radius],
      end: [to[0] - direction[0] * radius, to[1] - direction[1] * radius],
      length: length - 2 * radius,
    });
  }

  const captions: TreeCaption[] = gutter.lines.map((lines, level) => ({
    level,
    block: {
      lines,
      x: inset,
      y: rowY(level) - ((lines.length - 1) / 2) * sizes.label * CAPTION_LINE_HEIGHT,
      anchor: "start",
    },
  }));

  return {
    nodes,
    edges,
    captions,
    depth,
    radius,
    valueSize,
    labelSize: sizes.label,
    lineHeight,
    captionLineHeight: CAPTION_LINE_HEIGHT,
  };
}

const cache = new Map<string, TreeLayout>();

export function layoutTree(input: TreeInput): TreeLayout {
  const key = JSON.stringify(input);
  const known = cache.get(key);
  if (known) return known;
  const layout = computeLayout(input);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(key, layout);
  return layout;
}
