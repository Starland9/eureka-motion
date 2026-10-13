import { longestWord, monoWidth, wrapText } from "./measure";

export type Point = readonly [number, number];

export interface RelationsInput {
  nodes: readonly { id: string; label: string }[];
  edges: readonly { from: string; to: string; label?: string }[];
  width: number;
  height: number;
  u: number;
  inset: number;
  sizes: { body: number; min: number; label: number };
  headSize: number;
}

export interface NodeBox {
  id: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
}

export interface EdgeLine {
  from: string;
  to: string;
  label: string | undefined;
  start: Point;
  shaftEnd: Point;
  tip: Point;
  mid: Point;
  length: number;
  plate: { width: number; height: number };
}

export interface RelationsLayout {
  nodes: NodeBox[];
  edges: EdgeLine[];
  textSize: number;
  lineHeight: number;
}

const NODE_MAX_U = 30;
const NODE_COMFORT_U = 16;
const NODE_MIN_HEIGHT_U = 10;
const GAP_WANTED_U = 8;
const GAP_MIN_U = 3;
const GAP_CAP_U = 14;
const GAP_LABEL_U = 9;
const ROW_GAP_U = 2;
const PAD_X_U = 1.2;
const PAD_Y_U = 1.2;
const PLATE_PAD_U = 0.8;
const PARALLEL_OFFSET_U = 0.9;
const CLEARANCE_U = 0.8;
const LINE_HEIGHT = 1.2;
const SWEEPS = 3;
const CACHE_SIZE = 16;
const SHRINK_STEPS = [1, 0.85, 0.72, 0.6, 0.5];

interface Link {
  from: string;
  to: string;
  label: string | undefined;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function usableLinks(input: RelationsInput): Link[] {
  const known = new Set(input.nodes.map((node) => node.id));
  const seen = new Set<string>();
  const links: Link[] = [];
  for (const edge of input.edges) {
    const key = `${edge.from}>${edge.to}`;
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push({ from: edge.from, to: edge.to, label: edge.label });
  }
  return links;
}

function assignLayers(ids: readonly string[], links: readonly Link[]): Map<string, number> {
  const outgoing = new Map<string, Link[]>(ids.map((id) => [id, []]));
  const hasPredecessor = new Set<string>();
  for (const link of links) {
    outgoing.get(link.from)?.push(link);
    hasPredecessor.add(link.to);
  }

  const back = new Set<Link>();
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): void => {
    visiting.add(id);
    for (const link of outgoing.get(id) ?? []) {
      if (visiting.has(link.to)) back.add(link);
      else if (!done.has(link.to)) visit(link.to);
    }
    visiting.delete(id);
    done.add(id);
  };
  for (const id of [...ids.filter((candidate) => !hasPredecessor.has(candidate)), ...ids]) {
    if (!done.has(id)) visit(id);
  }

  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const link of links) if (!back.has(link)) incoming.get(link.to)?.push(link.from);
  const layers = new Map<string, number>();
  const layerOf = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    const layer = Math.max(-1, ...(incoming.get(id) ?? []).map(layerOf)) + 1;
    layers.set(id, layer);
    return layer;
  };
  for (const id of ids) layerOf(id);
  return layers;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

function hitsBox(a: Point, b: Point, box: Box): boolean {
  let enter = 0;
  let leave = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    return enter <= leave;
  };
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (
    clip(-dx, a[0] - box.left) &&
    clip(dx, box.right - a[0]) &&
    clip(-dy, a[1] - box.top) &&
    clip(dy, box.bottom - a[1])
  );
}

function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

function exitPoint(from: Point, direction: Point, box: Box): Point {
  const reach = (origin: number, step: number, low: number, high: number): number => {
    if (step > 0) return (high - origin) / step;
    if (step < 0) return (low - origin) / step;
    return Infinity;
  };
  const t = Math.min(
    reach(from[0], direction[0], box.left, box.right),
    reach(from[1], direction[1], box.top, box.bottom),
  );
  return [from[0] + direction[0] * t, from[1] + direction[1] * t];
}

function computeLayout(input: RelationsInput): RelationsLayout {
  const { u, inset } = input;
  const width = input.width - 2 * inset;
  const height = input.height - 2 * inset;
  const ids = input.nodes.map((node) => node.id);
  const links = usableLinks(input);
  const layers = assignLayers(ids, links);
  const layerCount = Math.max(...layers.values()) + 1;

  const plateOf = (label: string): { width: number; height: number } => ({
    width: monoWidth(label, input.sizes.label) + 2 * PLATE_PAD_U * u,
    height: input.sizes.label * LINE_HEIGHT + 2 * PLATE_PAD_U * u,
  });

  const wanted = Array.from({ length: layerCount - 1 }, () => GAP_WANTED_U * u);
  for (const link of links) {
    const a = layers.get(link.from) ?? 0;
    const b = layers.get(link.to) ?? 0;
    if (Math.abs(a - b) === 1 && link.label) {
      const slot = Math.min(a, b);
      wanted[slot] = Math.max(
        wanted[slot] ?? 0,
        plateOf(link.label).width + input.headSize + GAP_LABEL_U * u,
      );
    }
  }
  const wantedTotal = wanted.reduce((sum, gap) => sum + gap, 0);
  const minGap = GAP_MIN_U * u;
  const roomForNodes = (width - (layerCount - 1) * minGap) / layerCount;
  const textFloor = longestWord(
    input.nodes.map((node) => node.label),
    input.sizes.min,
  );
  const nodeWidth = Math.max(
    Math.min(NODE_MAX_U * u, (width - wantedTotal) / layerCount),
    Math.min(Math.max(NODE_COMFORT_U * u, textFloor + 2 * PAD_X_U * u), roomForNodes),
  );
  const free = width - layerCount * nodeWidth;
  const gaps =
    free >= wantedTotal
      ? wanted.map((gap) =>
          Math.max(
            gap,
            Math.min(gap + (free - wantedTotal) / Math.max(1, layerCount - 1), GAP_CAP_U * u),
          ),
        )
      : wanted.map(
          (gap) =>
            minGap +
            ((free - (layerCount - 1) * minGap) * (gap - minGap)) /
              Math.max(1e-9, wantedTotal - (layerCount - 1) * minGap),
        );
  const span = layerCount * nodeWidth + gaps.reduce((sum, gap) => sum + gap, 0);
  const columnX: number[] = [];
  let cursor = inset + (width - span) / 2;
  for (let layer = 0; layer < layerCount; layer++) {
    columnX.push(cursor);
    cursor += nodeWidth + (gaps[layer] ?? 0);
  }

  const columns: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) columns[layers.get(id) ?? 0]?.push(id);
  const rows = Math.max(...columns.map((column) => column.length));
  const available = (height - (rows - 1) * ROW_GAP_U * u) / rows;

  const textArea = nodeWidth - 2 * PAD_X_U * u;
  const labelOf = new Map(input.nodes.map((node) => [node.id, node.label]));
  const linesAt = (size: number): Map<string, string[]> =>
    new Map(ids.map((id) => [id, wrapText(labelOf.get(id) ?? "", textArea, size)]));
  const heightFor = (size: number): number =>
    Math.max(...[...linesAt(size).values()].map((lines) => lines.length)) * size * LINE_HEIGHT +
    2 * PAD_Y_U * u;
  const fits = (size: number): boolean =>
    heightFor(size) <= available &&
    longestWord(
      input.nodes.map((node) => node.label),
      size,
    ) <= textArea;
  // Past the minimum size a label would spill out of its box or break inside a word:
  // a smaller text is the lesser evil.
  const sizes = [input.sizes.body, ...SHRINK_STEPS.map((step) => input.sizes.min * step)];
  const textSize = sizes.find(fits) ?? (sizes.at(-1) as number);
  const nodeHeight = Math.min(available, Math.max(heightFor(textSize), NODE_MIN_HEIGHT_U * u));

  const centres = (order: readonly (readonly string[])[]): Map<string, Point> => {
    const found = new Map<string, Point>();
    order.forEach((column, layer) => {
      column.forEach((id, slot) => {
        found.set(id, [
          (columnX[layer] ?? 0) + nodeWidth / 2,
          inset + (height * (slot + 0.5)) / column.length,
        ]);
      });
    });
    return found;
  };
  const boxAt = (centre: Point, grow = 0): Box => ({
    left: centre[0] - nodeWidth / 2 - grow,
    right: centre[0] + nodeWidth / 2 + grow,
    top: centre[1] - nodeHeight / 2 - grow,
    bottom: centre[1] + nodeHeight / 2 + grow,
  });

  const cost = (order: readonly (readonly string[])[]): number => {
    const at = centres(order);
    const segments = links.map((link) => ({
      link,
      a: at.get(link.from) as Point,
      b: at.get(link.to) as Point,
    }));
    let blocked = 0;
    let crossings = 0;
    let slope = 0;
    segments.forEach(({ link, a, b }, i) => {
      for (const [id, centre] of at) {
        if (id !== link.from && id !== link.to && hitsBox(a, b, boxAt(centre, CLEARANCE_U * u))) {
          blocked++;
        }
      }
      for (const other of segments.slice(i + 1)) {
        const shared = [link.from, link.to].some(
          (id) => id === other.link.from || id === other.link.to,
        );
        if (!shared && crosses(a, b, other.a, other.b)) crossings++;
      }
      slope += (b[1] - a[1]) ** 2;
    });
    return blocked * 1e9 + crossings * 1e6 + slope / (u * u);
  };

  let order: string[][] = columns;
  let best = cost(order);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let improved = false;
    for (let layer = 0; layer < layerCount; layer++) {
      let winner = order[layer] ?? [];
      for (const candidate of permutations(winner)) {
        const price = cost(order.map((column, i) => (i === layer ? candidate : column)));
        if (price < best - 1e-6) {
          best = price;
          winner = candidate;
          improved = true;
        }
      }
      order = order.map((column, i) => (i === layer ? winner : column));
    }
    if (!improved) break;
  }

  const at = centres(order);
  const lineSets = linesAt(textSize);
  const nodes: NodeBox[] = input.nodes.map((node) => {
    const centre = at.get(node.id) as Point;
    return {
      id: node.id,
      layer: layers.get(node.id) ?? 0,
      x: centre[0] - nodeWidth / 2,
      y: centre[1] - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      lines: lineSets.get(node.id) ?? [],
    };
  });

  const reversed = new Set(links.map((link) => `${link.to}>${link.from}`));
  const edges: EdgeLine[] = [];
  for (const link of links) {
    const a = at.get(link.from) as Point;
    const b = at.get(link.to) as Point;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const shift = reversed.has(`${link.from}>${link.to}`) ? PARALLEL_OFFSET_U * u : 0;
    const normal: Point = [-direction[1] * shift, direction[0] * shift];
    const start = exitPoint([a[0] + normal[0], a[1] + normal[1]], direction, boxAt(a));
    const tip = exitPoint(
      [b[0] + normal[0], b[1] + normal[1]],
      [-direction[0], -direction[1]],
      boxAt(b),
    );
    const run = (tip[0] - start[0]) * direction[0] + (tip[1] - start[1]) * direction[1];
    if (run <= input.headSize) continue;
    const shaftEnd: Point = [
      tip[0] - direction[0] * input.headSize,
      tip[1] - direction[1] * input.headSize,
    ];
    edges.push({
      from: link.from,
      to: link.to,
      label: link.label,
      start,
      tip,
      shaftEnd,
      mid: [(start[0] + shaftEnd[0]) / 2, (start[1] + shaftEnd[1]) / 2],
      length: run - input.headSize,
      plate: link.label ? plateOf(link.label) : { width: 0, height: 0 },
    });
  }

  return { nodes, edges, textSize, lineHeight: LINE_HEIGHT };
}

const cache = new Map<string, RelationsLayout>();

export function layoutRelations(input: RelationsInput): RelationsLayout {
  const key = JSON.stringify(input);
  const known = cache.get(key);
  if (known) return known;
  const layout = computeLayout(input);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(key, layout);
  return layout;
}
