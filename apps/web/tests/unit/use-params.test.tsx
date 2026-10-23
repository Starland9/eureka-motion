// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  buildTimeline,
  DocumentSchema,
  locate,
  type ExplanationDocument,
  type Location,
} from "scene";
import { afterEach, describe, expect, it } from "vitest";
import { currentValue } from "@/components/controls/params-values";
import {
  animatedValues,
  initialParamsState,
  paramsReducer,
  shownValues,
  useParams,
  type ParamsInput,
  type ParamsLink,
} from "@/components/player/useParams";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const document: ExplanationDocument = DocumentSchema.parse(reference.payload);
const { scenes, params, model } = document;
const timeline = buildTimeline(scenes);
const distance = params.find((param) => param.id === "r")!;
const r0 = distance.default;

const timingOf = (id: string) => timeline.scenes.find((scene) => scene.id === id)!;

function at(sceneId: string, beatIndex: number, fraction: number): Location {
  const scene = timingOf(sceneId);
  const beat = scene.beats[beatIndex]!;
  const frame = scene.start + beat.start + Math.round(beat.duration * fraction);
  return locate(timeline, frame)!;
}

const midSweep = at("s3", 2, 0.3);
const peak = at("s3", 2, 0.55);
const afterSweep = at("s3", 2, 0.99);
const beforeSweep = at("s3", 1, 0.5);
const nextScene = at("s4", 0, 0.5);

function propsOf(extra: Record<string, unknown> = {}) {
  return {
    scenes,
    params,
    model,
    language: "fr" as const,
    theme: "paper" as const,
    values: {},
    reducedMotion: false,
    disableSweeps: false,
    ...extra,
  };
}

describe("paramsReducer", () => {
  it("keeps the values the student sets and leaves the state alone for an identical one", () => {
    const set = paramsReducer(initialParamsState, { type: "set", id: "r", value: 2e8 });
    expect(set.values).toEqual({ r: 2e8 });
    expect(paramsReducer(set, { type: "set", id: "r", value: 2e8 })).toBe(set);
  });

  it("goes back to the very initial state on reset", () => {
    const taken = paramsReducer(initialParamsState, {
      type: "take",
      scene: "s3",
      animated: { r: 5e8 },
    });
    const set = paramsReducer(taken, { type: "set", id: "m1", value: 2e24 });
    expect(paramsReducer(set, { type: "reset" })).toEqual(initialParamsState);
    expect(paramsReducer(initialParamsState, { type: "reset" })).toBe(initialParamsState);
  });

  it("freezes the animated values once, then ignores further takes of the same scene", () => {
    const taken = paramsReducer(initialParamsState, {
      type: "take",
      scene: "s3",
      animated: { r: 5e8 },
    });
    expect(taken).toMatchObject({ kept: "s3", values: { r: 5e8 } });
    const moved = paramsReducer(taken, { type: "set", id: "r", value: 3e8 });
    expect(paramsReducer(moved, { type: "take", scene: "s3", animated: { r: 5e8 } })).toBe(moved);
  });

  it("releases the scene on leave", () => {
    const taken = paramsReducer(initialParamsState, { type: "take", scene: "s3", animated: {} });
    expect(paramsReducer(taken, { type: "leave" }).kept).toBeNull();
    expect(paramsReducer(initialParamsState, { type: "leave" })).toBe(initialParamsState);
  });
});

describe("what the sliders show", () => {
  it("follows the swept parameter, between its start and its target", () => {
    const shown = shownValues(propsOf(), midSweep);
    expect(shown.r).toBeGreaterThan(r0);
    expect(shown.r).toBeLessThan(2 * r0);
    expect(shownValues(propsOf(), peak).r).toBeCloseTo(2 * r0, 0);
  });

  it("is the very object of the student values outside a sweep", () => {
    const values = { m1: 3e24 };
    for (const location of [beforeSweep, afterSweep, nextScene, null]) {
      expect(shownValues(propsOf({ values }), location)).toBe(values);
    }
  });

  it("starts from the value the student chose", () => {
    const chosen = 2e8;
    const shown = shownValues(propsOf({ values: { r: chosen } }), peak);
    expect(shown.r).toBeCloseTo(2 * chosen, 0);
    expect(animatedValues(propsOf({ values: { r: chosen } }), afterSweep)).toEqual({});
  });

  it("does not move under reduced motion nor while sweeps are disabled", () => {
    expect(animatedValues(propsOf({ reducedMotion: true }), peak)).toEqual({});
    expect(animatedValues(propsOf({ disableSweeps: true }), peak)).toEqual({});
  });

  it("stays inside the range of the slider", () => {
    const shown = shownValues(propsOf({ values: { r: distance.max } }), peak);
    expect(shown.r).toBe(distance.max);
  });
});

interface Harness {
  link: { current: ParamsLink };
  rerender(next: Partial<ParamsInput>): void;
  unmount(): void;
}

const mounted: Harness[] = [];

function mount(initial: Partial<ParamsInput> = {}): Harness {
  const base: ParamsInput = {
    scenes,
    params,
    model,
    language: "fr",
    theme: "paper",
    reducedMotion: false,
    location: beforeSweep,
    ...initial,
  };
  let input = base;
  const link = { current: undefined as unknown as ParamsLink };
  function Probe({ value }: { value: ParamsInput }) {
    link.current = useParams(value);
    return null;
  }
  const root = createRoot(globalThis.document.createElement("div"));
  act(() => root.render(<Probe value={input} />));
  const harness: Harness = {
    link,
    rerender(next) {
      input = { ...input, ...next };
      act(() => root.render(<Probe value={input} />));
    },
    unmount: () => act(() => root.unmount()),
  };
  mounted.push(harness);
  return harness;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount();
});

describe("useParams", () => {
  it("gives the player the same properties as long as nothing they depend on changes", () => {
    const harness = mount();
    const first = harness.link.current.inputProps;
    harness.rerender({});
    expect(harness.link.current.inputProps).toBe(first);
    harness.rerender({ location: midSweep });
    harness.rerender({ location: peak });
    harness.rerender({ location: nextScene });
    expect(harness.link.current.inputProps).toBe(first);
    expect(harness.link.current.values).toBe(first.values);
  });

  it("gives new properties when a slider moves, and the same ones for the same value", () => {
    const harness = mount();
    const first = harness.link.current.inputProps;
    act(() => harness.link.current.setValue("m1", 2e24));
    const second = harness.link.current.inputProps;
    expect(second).not.toBe(first);
    expect(second.values).toEqual({ m1: 2e24 });
    expect(second.scenes).toBe(first.scenes);
    act(() => harness.link.current.setValue("m1", 2e24));
    expect(harness.link.current.inputProps).toBe(second);
  });

  it("gives properties anew when the theme or the scenes change", () => {
    const harness = mount();
    const first = harness.link.current.inputProps;
    harness.rerender({ theme: "board" });
    expect(harness.link.current.inputProps).not.toBe(first);
    expect(harness.link.current.inputProps.theme).toBe("board");
  });

  it("keeps stable commands", () => {
    const harness = mount();
    const first = harness.link.current;
    harness.rerender({ location: peak });
    act(() => first.setValue("m1", 2e24));
    const { setValue, resetValues, setAdjusting } = harness.link.current;
    expect(setValue).toBe(first.setValue);
    expect(resetValues).toBe(first.resetValues);
    expect(setAdjusting).toBe(first.setAdjusting);
  });

  it("resets to the values of the document", () => {
    const harness = mount();
    act(() => {
      harness.link.current.setValue("m1", 2e24);
      harness.link.current.setValue("r", 3e8);
    });
    expect(harness.link.current.values).toEqual({ m1: 2e24, r: 3e8 });
    act(() => harness.link.current.resetValues());
    expect(harness.link.current.values).toEqual({});
    for (const param of params) {
      expect(currentValue(param, harness.link.current.values)).toBe(param.default);
    }
  });

  it("disables the sweeps during a gesture only", () => {
    const harness = mount({ location: beforeSweep });
    act(() => harness.link.current.setAdjusting(true));
    expect(harness.link.current.inputProps.disableSweeps).toBe(true);
    act(() => harness.link.current.setAdjusting(false));
    expect(harness.link.current.inputProps.disableSweeps).toBe(false);
  });

  it("lets the student take the hand during a sweep, at the value the slider showed", () => {
    const harness = mount({ location: midSweep });
    const animated = shownValues(harness.link.current.inputProps, midSweep).r!;
    expect(animated).not.toBe(r0);

    act(() => harness.link.current.setAdjusting(true));
    expect(harness.link.current.values.r).toBe(animated);
    expect(harness.link.current.inputProps.disableSweeps).toBe(true);

    act(() => harness.link.current.setValue("r", 2e8));
    act(() => harness.link.current.setAdjusting(false));
    harness.rerender({ location: peak });
    const props = harness.link.current.inputProps;
    expect(props.disableSweeps).toBe(true);
    expect(shownValues(props, peak).r).toBe(2e8);
    harness.rerender({ location: afterSweep });
    expect(shownValues(harness.link.current.inputProps, afterSweep).r).toBe(2e8);
  });

  it("takes the hand on a typed value too, without any gesture", () => {
    const harness = mount({ location: midSweep });
    act(() => harness.link.current.setValue("r", 2e8));
    expect(harness.link.current.inputProps.disableSweeps).toBe(true);
    expect(shownValues(harness.link.current.inputProps, midSweep).r).toBe(2e8);
  });

  it("gives the sweeps back when the scene ends, starting from the student value", () => {
    const harness = mount({ location: midSweep });
    act(() => harness.link.current.setValue("r", 2e8));
    expect(harness.link.current.inputProps.disableSweeps).toBe(true);

    harness.rerender({ location: nextScene });
    expect(harness.link.current.inputProps.disableSweeps).toBe(false);
    const sweeping = at("s4", 1, 0.6);
    harness.rerender({ location: sweeping });
    expect(shownValues(harness.link.current.inputProps, sweeping).r).toBeCloseTo(2 * 2e8, 0);
  });

  it("gives the sweeps back on reset", () => {
    const harness = mount({ location: midSweep });
    act(() => harness.link.current.setValue("r", 2e8));
    act(() => harness.link.current.resetValues());
    expect(harness.link.current.inputProps.disableSweeps).toBe(false);
    expect(harness.link.current.values).toEqual({});
    expect(shownValues(harness.link.current.inputProps, midSweep).r).toBeGreaterThan(r0);
  });

  it("does not take the hand where nothing sweeps", () => {
    const harness = mount({ location: beforeSweep });
    act(() => harness.link.current.setValue("m1", 2e24));
    act(() => harness.link.current.setAdjusting(true));
    act(() => harness.link.current.setAdjusting(false));
    expect(harness.link.current.inputProps.disableSweeps).toBe(false);
    expect(harness.link.current.values).toEqual({ m1: 2e24 });
  });
});
