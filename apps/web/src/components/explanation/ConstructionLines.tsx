import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import styles from "./construction.module.css";

const WIDTH = 160;
const HEIGHT = 90;
const STEP = 10;
const ORIGIN = { x: 20, y: 70 };

const VERTICALS = Array.from({ length: WIDTH / STEP - 1 }, (_, index) => (index + 1) * STEP);
const HORIZONTALS = Array.from({ length: HEIGHT / STEP - 1 }, (_, index) => (index + 1) * STEP);

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function Line({ order, kind, ...segment }: Segment & { order: number; kind: "axis" | "grid" }) {
  return (
    <line
      {...segment}
      pathLength={1}
      vectorEffect="non-scaling-stroke"
      style={{ "--i": order } as CSSProperties}
      className={cn(
        styles.line,
        kind === "axis" ? cn(styles.axis, "stroke-ink") : cn(styles.grid, "stroke-rule"),
      )}
    />
  );
}

export function ConstructionLines() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="size-full"
    >
      {VERTICALS.map((x, index) => (
        <Line
          key={`v${x}`}
          kind="grid"
          order={index + 2}
          x1={x}
          y1={STEP}
          x2={x}
          y2={HEIGHT - STEP}
        />
      ))}
      {HORIZONTALS.map((y, index) => (
        <Line
          key={`h${y}`}
          kind="grid"
          order={index + 2}
          x1={STEP}
          y1={y}
          x2={WIDTH - STEP}
          y2={y}
        />
      ))}
      <Line kind="axis" order={0} x1={STEP} y1={ORIGIN.y} x2={WIDTH - STEP} y2={ORIGIN.y} />
      <Line kind="axis" order={1} x1={ORIGIN.x} y1={HEIGHT - STEP} x2={ORIGIN.x} y2={STEP} />
    </svg>
  );
}
