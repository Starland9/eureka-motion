export type Pt = readonly [number, number];

const num = (value: number): string => String(Math.round(value * 100) / 100);
const at = ([x, y]: Pt): string => `${num(x)} ${num(y)}`;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export function open(...points: Pt[]): string {
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${at(point)}`).join("");
}

export function closed(...points: Pt[]): string {
  return `${open(...points)}Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rotation = 0): string {
  const dx = rx * Math.cos(radians(rotation));
  const dy = rx * Math.sin(radians(rotation));
  const a = at([cx - dx, cy - dy]);
  const b = at([cx + dx, cy + dy]);
  const arc = `A${num(rx)} ${num(ry)} ${num(rotation)} 1 0`;
  return `M${a}${arc} ${b}${arc} ${a}Z`;
}

export function circle(cx: number, cy: number, r: number): string {
  return ellipse(cx, cy, r, r);
}

export function arc(from: Pt, to: Pt, rx: number, ry: number, sweep: 0 | 1): string {
  return `M${at(from)}A${num(rx)} ${num(ry)} 0 0 ${sweep} ${at(to)}`;
}

export type Cubic = readonly [Pt, Pt, Pt];

export function cubics(start: Pt, ...segments: Cubic[]): { d: string; polygon: Pt[] } {
  const polygon: Pt[] = [start];
  let from = start;
  const parts = segments.map(([c1, c2, to]) => {
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const k = 1 - t;
      polygon.push([
        k * k * k * from[0] + 3 * k * k * t * c1[0] + 3 * k * t * t * c2[0] + t * t * t * to[0],
        k * k * k * from[1] + 3 * k * k * t * c1[1] + 3 * k * t * t * c2[1] + t * t * t * to[1],
      ]);
    }
    from = to;
    return `C${at(c1)} ${at(c2)} ${at(to)}`;
  });
  return { d: `M${at(start)}${parts.join("")}Z`, polygon };
}
