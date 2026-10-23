import { describe, expect, it } from "vitest";
import { prepareDocument } from "../src/document";
import { loadGravity } from "./helpers/support";

describe("prepareDocument", () => {
  it("accepts a stored payload whose quiz is null", async () => {
    const { payload, language } = await loadGravity();

    const document = prepareDocument({ ...payload, quiz: null }, language);

    expect(document.scenes).toHaveLength(6);
    expect(document.quiz).toBeUndefined();
  });

  it("keeps the quiz of a stored payload", async () => {
    const { payload, language } = await loadGravity();

    expect(prepareDocument(payload, language).quiz?.questions.length).toBeGreaterThan(0);
  });

  it("gives the same document for a payload that was typeset already", async () => {
    const { payload, language } = await loadGravity();

    const once = prepareDocument(payload, language);

    expect(prepareDocument(once, language)).toEqual(once);
  });

  it("rejects a payload that is not a document", async () => {
    const { payload, language } = await loadGravity();

    const empty = { ...payload, scenes: [] };

    expect(() => prepareDocument(empty, language)).toThrow();
  });
});
