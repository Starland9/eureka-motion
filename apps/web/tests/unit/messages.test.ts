import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";

const { fr, en } = messages;

function leaves(tree: unknown, path = ""): [string, unknown][] {
  if (typeof tree === "object" && tree !== null && !Array.isArray(tree)) {
    return Object.entries(tree).flatMap(([key, value]) =>
      leaves(value, path === "" ? key : `${path}.${key}`),
    );
  }
  return [[path, tree]];
}

describe("message files", () => {
  it("have exactly the same keys in French and English", () => {
    const frKeys = leaves(fr).map(([key]) => key);
    const enKeys = leaves(en).map(([key]) => key);
    expect(enKeys).toEqual(frKeys);
  });

  it.each([
    ["fr", fr],
    ["en", en],
  ])("contain no empty value in %s", (_locale, messages) => {
    for (const [key, value] of leaves(messages)) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim(), key).not.toBe("");
    }
  });
});
