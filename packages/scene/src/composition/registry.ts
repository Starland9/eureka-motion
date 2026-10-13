import type { ComponentType } from "react";
import type { ElementType } from "../schema/document";
import type { PrimitiveProps } from "./context";
import { isPlaceholder } from "../primitives/shared/Placeholder";
import { AnglePrimitive } from "../primitives/figure/angle";
import { AreaPrimitive } from "../primitives/figure/area";
import { ArraySim } from "../primitives/sim/array";
import { AxesPrimitive } from "../primitives/figure/axes";
import { BarsPrimitive } from "../primitives/figure/bars";
import { CircuitSim } from "../primitives/sim/circuit";
import { DimensionPrimitive } from "../primitives/figure/dimension";
import { FallSim } from "../primitives/sim/fall";
import { FlowSim } from "../primitives/sim/flow";
import { FormulaPrimitive } from "../primitives/text/formula";
import { ListPrimitive } from "../primitives/text/list";
import { MarketSim } from "../primitives/sim/market";
import { ObjectPrimitive } from "../primitives/figure/object";
import { OrbitSim } from "../primitives/sim/orbit";
import { PendulumSim } from "../primitives/sim/pendulum";
import { PlotPrimitive } from "../primitives/figure/plot";
import { PointPrimitive } from "../primitives/figure/point";
import { ReactionSim } from "../primitives/sim/reaction";
import { ReadoutPrimitive } from "../primitives/text/readout";
import { RelationsPrimitive } from "../primitives/structure/relations";
import { RightTriangleSim } from "../primitives/sim/right-triangle";
import { SegmentPrimitive } from "../primitives/figure/segment";
import { ShapePrimitive } from "../primitives/figure/shape";
import { StepsPrimitive } from "../primitives/structure/steps";
import { TablePrimitive } from "../primitives/structure/table";
import { TangentPrimitive } from "../primitives/figure/tangent";
import { TextPrimitive } from "../primitives/text/text";
import { TimelinePrimitive } from "../primitives/structure/timeline";
import { TreePrimitive } from "../primitives/structure/tree";
import { TwoBodySim } from "../primitives/sim/two-body";
import { VectorPrimitive } from "../primitives/figure/vector";
import { WaveSim } from "../primitives/sim/wave";

export type PrimitiveKind = "svg" | "html";
export type PrimitiveComponent = ComponentType<PrimitiveProps>;

export interface PrimitiveEntry {
  kind: PrimitiveKind;
  Component: PrimitiveComponent;
}

export const registry: Readonly<Record<ElementType, PrimitiveEntry>> = {
  text: { kind: "html", Component: TextPrimitive as PrimitiveComponent },
  list: { kind: "html", Component: ListPrimitive as PrimitiveComponent },
  formula: { kind: "html", Component: FormulaPrimitive as PrimitiveComponent },
  readout: { kind: "html", Component: ReadoutPrimitive as PrimitiveComponent },
  timeline: { kind: "html", Component: TimelinePrimitive as PrimitiveComponent },
  steps: { kind: "html", Component: StepsPrimitive as PrimitiveComponent },
  table: { kind: "html", Component: TablePrimitive as PrimitiveComponent },
  axes: { kind: "svg", Component: AxesPrimitive as PrimitiveComponent },
  plot: { kind: "svg", Component: PlotPrimitive as PrimitiveComponent },
  point: { kind: "svg", Component: PointPrimitive as PrimitiveComponent },
  area: { kind: "svg", Component: AreaPrimitive as PrimitiveComponent },
  tangent: { kind: "svg", Component: TangentPrimitive as PrimitiveComponent },
  bars: { kind: "svg", Component: BarsPrimitive as PrimitiveComponent },
  segment: { kind: "svg", Component: SegmentPrimitive as PrimitiveComponent },
  vector: { kind: "svg", Component: VectorPrimitive as PrimitiveComponent },
  dimension: { kind: "svg", Component: DimensionPrimitive as PrimitiveComponent },
  angle: { kind: "svg", Component: AnglePrimitive as PrimitiveComponent },
  shape: { kind: "svg", Component: ShapePrimitive as PrimitiveComponent },
  object: { kind: "svg", Component: ObjectPrimitive as PrimitiveComponent },
  relations: { kind: "svg", Component: RelationsPrimitive as PrimitiveComponent },
  tree: { kind: "svg", Component: TreePrimitive as PrimitiveComponent },
  "sim.two-body": { kind: "svg", Component: TwoBodySim as PrimitiveComponent },
  "sim.fall": { kind: "svg", Component: FallSim as PrimitiveComponent },
  "sim.orbit": { kind: "svg", Component: OrbitSim as PrimitiveComponent },
  "sim.pendulum": { kind: "svg", Component: PendulumSim as PrimitiveComponent },
  "sim.circuit": { kind: "svg", Component: CircuitSim as PrimitiveComponent },
  "sim.wave": { kind: "svg", Component: WaveSim as PrimitiveComponent },
  "sim.right-triangle": { kind: "svg", Component: RightTriangleSim as PrimitiveComponent },
  "sim.reaction": { kind: "svg", Component: ReactionSim as PrimitiveComponent },
  "sim.flow": { kind: "svg", Component: FlowSim as PrimitiveComponent },
  "sim.array": { kind: "svg", Component: ArraySim as PrimitiveComponent },
  "sim.market": { kind: "svg", Component: MarketSim as PrimitiveComponent },
};

export function isImplemented(type: ElementType): boolean {
  return !isPlaceholder(registry[type].Component);
}

export function implementedTypes(): ElementType[] {
  return (Object.keys(registry) as ElementType[]).filter(isImplemented);
}
