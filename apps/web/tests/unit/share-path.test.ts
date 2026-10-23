import { describe, expect, it } from "vitest";
import { sharePathOf } from "@/components/explanation/share-path";
import { initialExplanationState } from "@/components/explanation/types";

const base = {
  ...initialExplanationState({ question: "", language: "en", level: "lycee" }),
  id: "kkkkkkkkkkk2",
};

describe("sharePathOf", () => {
  it("is empty without an explanation", () => {
    expect(sharePathOf(null)).toBeNull();
    expect(sharePathOf({ ...base, id: null, status: "ready" })).toBeNull();
  });

  it.each([
    "connecting",
    "preparing",
    "streaming",
    "clarify",
    "refused",
    "failed",
    "missing",
  ] as const)("is empty while the explanation is %s", (status) => {
    expect(sharePathOf({ ...base, status })).toBeNull();
  });

  it.each(["ready", "partial"] as const)("is the page of a %s explanation", (status) => {
    expect(sharePathOf({ ...base, status })).toBe("/en/e/kkkkkkkkkkk2");
  });

  it("prefers the address the server sent", () => {
    expect(sharePathOf({ ...base, status: "ready", shareUrl: "/fr/e/kkkkkkkkkkk2" })).toBe(
      "/fr/e/kkkkkkkkkkk2",
    );
  });
});
