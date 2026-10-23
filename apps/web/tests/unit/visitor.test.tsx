// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialExplanationState } from "@/components/explanation/types";
import { useIsVisitor } from "@/components/explanation/useIsVisitor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "kkkkkkkkkkk2";
const OTHER = "mmmmmmmmmmm3";
const base = initialExplanationState({ question: "", language: "fr", level: "lycee" });
const mounted: { root: Root; host: HTMLElement }[] = [];

type View = Parameters<typeof useIsVisitor>;

function Probe({ args, out }: { args: View; out: { visitor: boolean } }) {
  out.visitor = useIsVisitor(...args);
  return null;
}

function render(...args: View) {
  const out = { visitor: false };
  const host = window.document.createElement("div");
  const root = createRoot(host);
  mounted.push({ root, host });
  const draw = (next: View) => act(() => root.render(<Probe args={next} out={out} />));
  draw(args);
  return { out, draw };
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  for (const { root } of mounted.splice(0)) act(() => root.unmount());
});

describe("useIsVisitor", () => {
  it("is false while nothing is loaded", () => {
    expect(render(null, false).out.visitor).toBe(false);
  });

  it("is true for an explanation this session did not start", () => {
    expect(render({ ...base, id: ID }, false).out.visitor).toBe(true);
  });

  it("is false for the explanation this session started, and remembers it", () => {
    const { out, draw } = render({ ...base, id: ID }, true);
    expect(out.visitor).toBe(false);
    expect(localStorage.getItem(`eureka.mine.${ID}`)).toBe("1");

    draw([{ ...base, id: ID }, false]);
    expect(out.visitor).toBe(false);
  });

  it("stays false after a reload, which empties the session", () => {
    render({ ...base, id: ID }, true);
    const reloaded = render({ ...base, id: ID }, false);
    expect(reloaded.out.visitor).toBe(false);
  });

  it("is still true for another explanation of the same device", () => {
    render({ ...base, id: ID }, true);
    expect(render({ ...base, id: OTHER }, false).out.visitor).toBe(true);
  });

  it("is false for a reference, which has no owner", () => {
    const state = { ...base, id: ID, reference: { question: "la loi de la gravité" } };
    expect(render(state, false).out.visitor).toBe(false);
  });

  it("is true again when the storage is unavailable after a reload", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(render({ ...base, id: ID }, false).out.visitor).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
