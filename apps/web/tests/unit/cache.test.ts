import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeQuestion, questionHash } from "@/server/db/normalize";

describe("normalizeQuestion", () => {
  it("removes a French request phrase and the punctuation around the concept", () => {
    expect(normalizeQuestion("Je n'ai pas compris la loi de la gravité !", "fr")).toBe(
      "la loi de la gravité",
    );
  });

  it("removes an English request phrase and the politeness at the end", () => {
    expect(normalizeQuestion("Explain photosynthesis please", "en")).toBe("photosynthesis");
  });

  it.each([
    ["Je ne comprends pas la gravité", "la gravité"],
    ["j'ai pas compris la gravité", "la gravité"],
    ["Je n'ai rien compris à la gravité", "la gravité"],
    ["Explique-moi la gravité", "la gravité"],
    ["Expliquez-moi la gravité", "la gravité"],
    ["explique moi la gravité", "la gravité"],
    ["C'est quoi la gravité ?", "la gravité"],
    ["La gravité, c'est quoi ?", "la gravité"],
    ["Qu'est-ce que la gravité ?", "la gravité"],
    ["Qu'est-ce que c'est que la gravité ?", "la gravité"],
    ["Qu'est-ce qu'une dérivée ?", "une dérivée"],
    ["Peux-tu m'expliquer la gravité ?", "la gravité"],
    ["Pouvez-vous m’expliquer la gravité", "la gravité"],
    ["Comment fonctionne la gravité ?", "la gravité"],
    ["Comment fonctionnent les vaccins", "les vaccins"],
    ["la gravité s'il te plaît", "la gravité"],
    ["la gravité s’il vous plait", "la gravité"],
    ["Explique la gravité stp", "la gravité"],
    ["svp la gravité", "la gravité"],
    ["Explique-moi la gravité, merci !", "la gravité"],
    ["Merci d'avance, explique-moi la gravité", "la gravité"],
    ["Je n'ai pas compris ce qu'est la gravité, stp ?", "la gravité"],
  ])("French: %s", (input, expected) => {
    expect(normalizeQuestion(input, "fr")).toBe(expected);
  });

  it.each([
    ["I don't understand gravity", "gravity"],
    ["I did not understand gravity", "gravity"],
    ["i didn’t understand gravity", "gravity"],
    ["Explain gravity", "gravity"],
    ["Explain to me gravity", "gravity"],
    ["Can you explain gravity?", "gravity"],
    ["Can you please explain gravity", "gravity"],
    ["What is gravity?", "gravity"],
    ["What's gravity", "gravity"],
    ["What is the gravity?", "the gravity"],
    ["How does photosynthesis work?", "photosynthesis"],
    ["How do vaccines work", "vaccines"],
    ["Gravity, thanks!", "gravity"],
    ["Please explain gravity. Thank you", "gravity"],
    ["I don't understand: what is gravity, please?", "gravity"],
  ])("English: %s", (input, expected) => {
    expect(normalizeQuestion(input, "en")).toBe(expected);
  });

  it("keeps the leading articles", () => {
    expect(normalizeQuestion("la gravité", "fr")).toBe("la gravité");
    expect(normalizeQuestion("Explain the gravity", "en")).toBe("the gravity");
  });

  it("lowercases, applies NFKC and unifies apostrophes and dashes", () => {
    expect(normalizeQuestion("L’ÉNERGIE  d’un\tphoton", "fr")).toBe("l'énergie d'un photon");
    expect(normalizeQuestion("L'énergie d'un photon", "fr")).toBe("l'énergie d'un photon");
    expect(normalizeQuestion("ｆｕｌｌ　ｗｉｄｔｈ ﬁne", "en")).toBe("full width fine");
    expect(normalizeQuestion("explique–moi la gravité", "fr")).toBe("la gravité");
    expect(normalizeQuestion("l`atome  d´hydrogène", "fr")).toBe("l'atome d'hydrogène");
  });

  it("reduces punctuation and spaces but keeps what carries meaning", () => {
    expect(normalizeQuestion("  « La   gravité »…  ", "fr")).toBe("la gravité");
    expect(normalizeQuestion("pi = 3.14 (environ)", "fr")).toBe("pi = 3.14 environ");
    expect(normalizeQuestion("la dérivée de x-1 ; 50 % ; a/b", "fr")).toBe(
      "la dérivée de x-1 50 % a/b",
    );
    expect(normalizeQuestion("la valeur -3, ou - 4", "fr")).toBe("la valeur -3 ou 4");
  });

  it("only strips the phrases of the given language", () => {
    expect(normalizeQuestion("explain gravity", "fr")).toBe("explain gravity");
    expect(normalizeQuestion("explique la gravité", "en")).toBe("explique la gravité");
  });

  it("does not strip a phrase that is only the start of a longer word", () => {
    expect(normalizeQuestion("explications de la gravité", "fr")).toBe(
      "explications de la gravité",
    );
    expect(normalizeQuestion("whatsapp et la messagerie", "en")).toBe("whatsapp et la messagerie");
  });

  it("falls back to the cleaned text when nothing else is left", () => {
    expect(normalizeQuestion("Explique-moi !", "fr")).toBe("explique-moi");
    expect(normalizeQuestion("Merci", "fr")).toBe("merci");
    expect(normalizeQuestion("Please", "en")).toBe("please");
  });
});

describe("questionHash", () => {
  it("gives the same hash to a request and to the bare concept", () => {
    expect(questionHash("Je n'ai pas compris la loi de la gravité !", "fr")).toBe(
      questionHash("la loi de la gravité", "fr"),
    );
    expect(questionHash("Explain photosynthesis please", "en")).toBe(
      questionHash("photosynthesis", "en"),
    );
  });

  it("is the SHA-256 in hexadecimal of the normalised text", () => {
    const expected = createHash("sha256").update("la loi de la gravité", "utf8").digest("hex");
    expect(questionHash("La loi de la gravité ?", "fr")).toBe(expected);
    expect(questionHash("anything", "en")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates two different concepts", () => {
    expect(questionHash("la gravité", "fr")).not.toBe(questionHash("la gravitation", "fr"));
  });

  it("makes the language the only difference between two keys of the same text", () => {
    const text = "la loi de la gravité";
    expect(normalizeQuestion(text, "fr")).toBe(normalizeQuestion(text, "en"));
    expect(questionHash(text, "fr")).toBe(questionHash(text, "en"));
  });
});
