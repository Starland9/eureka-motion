import { describeCatalog, ELEMENT_TYPES, isImplemented, type ElementType } from "scene";
import type { Subject } from "./schemas";

const SIMULATIONS: Readonly<Record<Subject, readonly ElementType[]>> = {
  maths: ["sim.right-triangle"],
  physics: ["sim.two-body", "sim.fall", "sim.orbit", "sim.pendulum", "sim.circuit", "sim.wave"],
  chemistry: ["sim.reaction"],
  biology: ["sim.flow"],
  cs: ["sim.array"],
  economics: ["sim.market"],
  other: [],
};

export function typesFor(subject: Subject): ElementType[] {
  const simulations = new Set(SIMULATIONS[subject]);
  const everything = process.env.SCENE_CATALOG === "all";
  return ELEMENT_TYPES.filter(
    (type) =>
      (everything || isImplemented(type)) && (!type.startsWith("sim.") || simulations.has(type)),
  );
}

const cache = new Map<string, string>();

export function catalogFor(subject: Subject): string {
  const types = typesFor(subject);
  const key = types.join(",");
  let text = cache.get(key);
  if (text === undefined) {
    text = describeCatalog({ types });
    cache.set(key, text);
  }
  return text;
}
