import { describe, expect, it } from "vitest";
import { createExplanationClient } from "../../src/components/explanation/stream";

const REQUEST = { question: "pourquoi le ciel est bleu", language: "fr", level: "lycee" } as const;

const ENTRY = {
  slug: "physics/universal-gravitation",
  subject: "physics",
  title: "La gravitation universelle",
  reference_level: "lycee",
  explanation_id: "abcdefghjkmn",
};

function startWith(references: unknown) {
  const client = createExplanationClient({
    fetch: async () =>
      Response.json(
        { error: { code: "generation_unavailable", message: "indisponible" }, references },
        { status: 503 },
      ),
  });
  return { client, outcome: client.start(REQUEST) };
}

describe("a 503 generation_unavailable seen by the client", () => {
  it("hands over the references of the body with the code and the message", async () => {
    const { client, outcome } = startWith([ENTRY]);
    expect(await outcome).toStrictEqual({
      kind: "rejected",
      code: "generation_unavailable",
      message: "indisponible",
      references: [ENTRY],
    });
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
  });

  it("keeps an empty list as an empty list", async () => {
    expect(await startWith([]).outcome).toMatchObject({ references: [] });
  });

  it("drops the entries that are not references", async () => {
    const broken = [
      null,
      "text",
      { ...ENTRY, explanation_id: 7 },
      { ...ENTRY, reference_level: "doctorat" },
      { ...ENTRY, title: undefined },
    ];
    const { outcome } = startWith([ENTRY, ...broken]);
    expect(await outcome).toMatchObject({ references: [ENTRY] });
  });

  it("ignores a list that is not a list", async () => {
    expect(await startWith({ 0: ENTRY }).outcome).not.toHaveProperty("references");
    expect(await startWith("none").outcome).not.toHaveProperty("references");
  });
});
