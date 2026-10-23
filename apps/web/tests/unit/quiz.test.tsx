// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSchema, type Quiz as QuizDocument } from "scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Quiz, type QuizProps } from "@/components/quiz/Quiz";
import { messages } from "@/i18n/messages";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lang = "fr" | "en";

const quiz: QuizDocument = DocumentSchema.parse(reference.payload).quiz!;
const SCENE_NUMBERS = { s3: 3, s4: 4 };

interface Mounted {
  container: HTMLElement;
  props: ReturnType<typeof callbacks>;
  root: Root;
}

function callbacks() {
  return {
    onReviewScene: vi.fn<(sceneId: string) => void>(),
    onExit: vi.fn<() => void>(),
    onAnswersChange: vi.fn<(answers: readonly string[]) => void>(),
    onFinish: vi.fn<(score: number) => void>(),
  };
}

const mounted: Mounted[] = [];

function mount(
  extra: Partial<QuizProps> = {},
  locale: Lang = "fr",
  document: QuizDocument = quiz,
): Mounted {
  const props = callbacks();
  const container = globalThis.document.createElement("div");
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        <Quiz quiz={document} sceneNumbers={SCENE_NUMBERS} {...props} {...extra} />
      </NextIntlClientProvider>,
    ),
  );
  const handle = { container, props, root };
  mounted.push(handle);
  return handle;
}

afterEach(() => {
  while (mounted.length > 0) {
    const { root, container } = mounted.pop()!;
    act(() => root.unmount());
    container.remove();
  }
});

function plain(node: Node | null | undefined): string {
  if (!node) return "";
  const walker = globalThis.document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    parts.push(text.textContent ?? "");
  }
  return parts
    .join(" ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const choices = (m: Mounted): HTMLButtonElement[] => [
  ...m.container.querySelectorAll<HTMLButtonElement>("ol button"),
];

function choice(m: Mounted, letter: string): HTMLButtonElement {
  const found = choices(m).find((button) => plain(button).startsWith(letter));
  if (!found) throw new Error(`no choice ${letter}`);
  return found;
}

function action(m: Mounted, name: string | RegExp): HTMLButtonElement | undefined {
  return [...m.container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    typeof name === "string" ? plain(button) === name : name.test(plain(button)),
  );
}

function press(button: HTMLElement | undefined): void {
  if (!button) throw new Error("button not found");
  act(() => button.click());
}

const status = (m: Mounted): string => plain(m.container.querySelector('[role="status"]'));
const caption = (m: Mounted): string => plain(m.container.querySelector("p.text-caption"));

function rows(m: Mounted) {
  return choices(m).map((button) => ({
    text: plain(button),
    highlighted: button.classList.contains("bg-role-result"),
    crossed: button.classList.contains("border-role-action"),
    disabled: button.getAttribute("aria-disabled") === "true",
  }));
}

const verdictRule = (m: Mounted): string =>
  m.container.querySelector('[role="status"]')?.parentElement?.parentElement?.className ?? "";

function playAll(m: Mounted, answers: readonly string[], total = 3): void {
  answers.forEach((letter, index) => {
    press(choice(m, letter));
    press(action(m, index === total - 1 ? /^Voir mon score/ : /^Exercice suivant/));
  });
}

describe("the first exercise", () => {
  it("lays the question out as a textbook exercise, with lettered answers", () => {
    const m = mount();
    expect(caption(m)).toBe("Exercice 1 sur 3");
    expect(plain(m.container.querySelector("p[tabindex='-1']"))).toBe(quiz.questions[0]!.prompt);
    expect(choices(m).map((button) => plain(button))).toEqual([
      "A est divisée par deux",
      "B est divisée par quatre",
      "C double",
      "D ne change pas",
    ]);
    expect(m.container.querySelector("ol[aria-labelledby]")).not.toBeNull();
  });

  it("shows no correction and no way forward before an answer", () => {
    const m = mount();
    expect(status(m)).toBe("");
    expect(action(m, /suivant|score/)).toBeUndefined();
    expect(rows(m).every((row) => !row.highlighted && !row.crossed && !row.disabled)).toBe(true);
  });

  it("answers with native buttons, which Enter and Space already activate", () => {
    const m = mount();
    for (const button of choices(m)) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.type).toBe("button");
      expect(button.getAttribute("role")).toBeNull();
      expect(button.disabled).toBe(false);
    }
    expect(m.container.querySelector('[role="radio"], [role="radiogroup"], input')).toBeNull();
  });
});

describe("a right answer", () => {
  it("is confirmed with an icon, a text and a rule, and the explanation", () => {
    const m = mount();
    press(choice(m, "B"));
    expect(status(m)).toBe(`Correct. ${quiz.questions[0]!.explanation}`);
    expect(verdictRule(m)).toContain("border-role-valid");
    expect(verdictRule(m)).not.toContain("border-role-action");
    expect(m.container.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(rows(m)[1]).toMatchObject({
      text: "B est divisée par quatre [Bonne réponse]",
      highlighted: true,
    });
    expect(rows(m).filter((row) => row.highlighted)).toHaveLength(1);
    expect(rows(m).filter((row) => row.crossed)).toHaveLength(0);
  });

  it("offers the next exercise but no link back to the scene", () => {
    const m = mount();
    press(choice(m, "B"));
    expect(action(m, /^Revoir/)).toBeUndefined();
    expect(action(m, "Exercice suivant →")).toBeDefined();
    expect(m.props.onAnswersChange).toHaveBeenCalledExactlyOnceWith(["b"]);
    expect(m.props.onFinish).not.toHaveBeenCalled();
  });
});

describe("a wrong answer", () => {
  it("is corrected: the right answer is named and highlighted, the chosen one is crossed", () => {
    const m = mount();
    press(choice(m, "A"));
    expect(status(m)).toBe(
      `Pas tout à fait. La bonne réponse est B. ${quiz.questions[0]!.explanation}`,
    );
    expect(verdictRule(m)).toContain("border-role-action");
    expect(verdictRule(m)).not.toContain("border-role-valid");
    expect(rows(m)).toMatchObject([
      { text: "A est divisée par deux [Ta réponse]", crossed: true, highlighted: false },
      { text: "B est divisée par quatre [Bonne réponse]", highlighted: true, crossed: false },
      { text: "C double", highlighted: false, crossed: false },
      { text: "D ne change pas", highlighted: false, crossed: false },
    ]);
  });

  it("sends the student back to the scene of the question", () => {
    const m = mount();
    press(choice(m, "A"));
    const link = action(m, "Revoir la scène 03 →");
    expect(link).toBeDefined();
    press(link);
    expect(m.props.onReviewScene).toHaveBeenCalledExactlyOnceWith("s3");
  });

  it("sends the student to the scene of the third question", () => {
    const m = mount();
    playAll(m, ["B", "C"]);
    press(choice(m, "B"));
    press(action(m, "Revoir la scène 04 →"));
    expect(m.props.onReviewScene).toHaveBeenCalledExactlyOnceWith("s4");
  });

  it("falls back to a link without number when the scene has none", () => {
    const m = mount({ sceneNumbers: undefined });
    press(choice(m, "A"));
    expect(action(m, "Revoir la scène →")).toBeDefined();
  });
});

describe("an answer given", () => {
  it("cannot be changed", () => {
    const m = mount();
    press(choice(m, "A"));
    const before = rows(m);
    press(choice(m, "B"));
    press(choice(m, "C"));
    expect(rows(m)).toEqual(before);
    expect(m.props.onAnswersChange).toHaveBeenCalledExactlyOnceWith(["a"]);
    expect(choices(m).every((button) => button.getAttribute("aria-disabled") === "true")).toBe(
      true,
    );
  });
});

describe("keyboard", () => {
  it("does not answer on an arrow key", () => {
    const m = mount();
    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]) {
      for (const button of choices(m)) {
        act(() => {
          button.focus();
          button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
          button.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
        });
      }
    }
    expect(status(m)).toBe("");
    expect(m.props.onAnswersChange).not.toHaveBeenCalled();
    expect(rows(m).every((row) => !row.disabled)).toBe(true);
  });

  it("keeps the focus on the answered button", () => {
    const m = mount();
    press(choice(m, "A"));
    expect(globalThis.document.activeElement).toBe(choice(m, "A"));
  });

  it("moves the focus to the next exercise, then to the score", () => {
    const m = mount();
    press(choice(m, "B"));
    press(action(m, "Exercice suivant →"));
    expect(caption(m)).toBe("Exercice 2 sur 3");
    expect(globalThis.document.activeElement).toBe(m.container.querySelector("p[tabindex='-1']"));
    press(choice(m, "C"));
    press(action(m, "Exercice suivant →"));
    press(choice(m, "A"));
    press(action(m, "Voir mon score →"));
    expect(globalThis.document.activeElement).toBe(m.container.querySelector("h2"));
  });

  it("does not take the focus on its own", () => {
    const m = mount();
    expect(m.container.contains(globalThis.document.activeElement)).toBe(false);
  });

  it("tabs through the exit, the answers, then what the correction offers", () => {
    const m = mount();
    press(choice(m, "A"));
    const order = [...m.container.querySelectorAll<HTMLElement>("button")].map((button) =>
      plain(button),
    );
    expect(order).toEqual([
      "Quitter le quiz",
      "A est divisée par deux [Ta réponse]",
      "B est divisée par quatre [Bonne réponse]",
      "C double",
      "D ne change pas",
      "Revoir la scène 03 →",
      "Exercice suivant →",
    ]);
    expect(m.container.querySelector("[tabindex]:not([tabindex='-1'])")).toBeNull();
  });
});

describe("the final score", () => {
  it("counts the right answers and lists each exercise", () => {
    const m = mount();
    playAll(m, ["B", "A", "A"]);
    expect(plain(m.container.querySelector("h2"))).toBe("2 sur 3");
    expect(caption(m)).toBe("Résultat");
    expect(m.props.onFinish).toHaveBeenCalledExactlyOnceWith(2);
    const items = [...m.container.querySelectorAll("ol li")].map((li) => plain(li));
    expect(items).toEqual([
      `Exercice 1 Correct. ${quiz.questions[0]!.prompt}`,
      `Exercice 2 Pas tout à fait. ${quiz.questions[1]!.prompt} Revoir la scène 03 →`,
      `Exercice 3 Correct. ${quiz.questions[2]!.prompt}`,
    ]);
    expect(plain(m.container)).toContain("1 réponse est à revoir.");
  });

  it("reminds the student who made an error that another explanation exists", () => {
    const m = mount();
    playAll(m, ["B", "A", "A"]);
    expect(plain(m.container)).toContain("Je n’ai toujours pas compris");
  });

  it("sends back to the scene of a missed question from the score too", () => {
    const m = mount();
    playAll(m, ["A", "C", "B"]);
    expect(plain(m.container.querySelector("h2"))).toBe("1 sur 3");
    const links = [...m.container.querySelectorAll("button")].filter((button) =>
      plain(button).startsWith("Revoir"),
    );
    expect(links.map((link) => plain(link))).toEqual([
      "Revoir la scène 03 →",
      "Revoir la scène 04 →",
    ]);
    press(links[1]);
    expect(m.props.onReviewScene).toHaveBeenCalledExactlyOnceWith("s4");
  });

  it("is perfect without reminder when everything is right", () => {
    const m = mount();
    playAll(m, ["B", "C", "A"]);
    expect(plain(m.container.querySelector("h2"))).toBe("3 sur 3");
    expect(plain(m.container)).toContain("Toutes les réponses sont justes.");
    expect(plain(m.container)).not.toContain("Je n’ai toujours pas compris");
    expect(action(m, /^Revoir/)).toBeUndefined();
    expect(m.props.onFinish).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("is zero when everything is wrong", () => {
    const m = mount();
    playAll(m, ["A", "A", "B"]);
    expect(plain(m.container.querySelector("h2"))).toBe("0 sur 3");
    expect(m.props.onFinish).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("handles a quiz of two questions with three choices", () => {
    const short: QuizDocument = { questions: quiz.questions.slice(1) };
    const m = mount({}, "fr", short);
    expect(caption(m)).toBe("Exercice 1 sur 2");
    expect(choices(m)).toHaveLength(3);
    playAll(m, ["C", "A"], 2);
    expect(plain(m.container.querySelector("h2"))).toBe("2 sur 2");
  });
});

describe("leaving", () => {
  it("is possible before any answer", () => {
    const m = mount();
    press(action(m, "Quitter le quiz"));
    expect(m.props.onExit).toHaveBeenCalledOnce();
    expect(m.props.onAnswersChange).not.toHaveBeenCalled();
  });

  it("is possible after an answer, which the caller has already received", () => {
    const m = mount();
    press(choice(m, "A"));
    press(action(m, "Quitter le quiz"));
    expect(m.props.onExit).toHaveBeenCalledOnce();
    expect(m.props.onAnswersChange).toHaveBeenLastCalledWith(["a"]);
  });

  it("is possible between two exercises, and from the score", () => {
    const m = mount();
    press(choice(m, "B"));
    press(action(m, "Exercice suivant →"));
    press(action(m, "Quitter le quiz"));
    expect(m.props.onExit).toHaveBeenCalledOnce();
    press(choice(m, "C"));
    press(action(m, "Exercice suivant →"));
    press(choice(m, "A"));
    press(action(m, "Voir mon score →"));
    press(action(m, "Fermer le quiz"));
    expect(m.props.onExit).toHaveBeenCalledTimes(2);
  });

  it("resumes where the student was, with the answers kept", () => {
    const first = mount();
    press(choice(first, "B"));
    press(action(first, "Exercice suivant →"));
    press(choice(first, "A"));
    const kept = first.props.onAnswersChange.mock.lastCall![0];
    expect(kept).toEqual(["b", "a"]);

    const second = mount({ initialAnswers: kept });
    expect(caption(second)).toBe("Exercice 3 sur 3");
    expect(second.props.onAnswersChange).not.toHaveBeenCalled();
    press(choice(second, "A"));
    press(action(second, "Voir mon score →"));
    expect(plain(second.container.querySelector("h2"))).toBe("2 sur 3");
    expect(second.props.onFinish).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("shows the score straight away for a quiz already complete, without finishing again", () => {
    const m = mount({ initialAnswers: ["b", "c", "b"] });
    expect(plain(m.container.querySelector("h2"))).toBe("2 sur 3");
    expect(m.props.onFinish).not.toHaveBeenCalled();
  });
});

describe("in English", () => {
  it("corrects a right and a wrong answer and gives the score", () => {
    const m = mount({}, "en");
    expect(caption(m)).toBe("Exercise 1 of 3");
    press(choice(m, "B"));
    expect(status(m)).toBe(`Correct. ${quiz.questions[0]!.explanation}`);
    expect(rows(m)[1]!.text).toBe("B est divisée par quatre [Right answer]");
    press(action(m, "Next exercise →"));
    press(choice(m, "A"));
    expect(status(m)).toBe(`Not quite. The right answer is C. ${quiz.questions[1]!.explanation}`);
    expect(rows(m)[0]!.text).toContain("[Your answer]");
    press(action(m, "Review scene 03 →"));
    expect(m.props.onReviewScene).toHaveBeenCalledExactlyOnceWith("s3");
    press(action(m, "Next exercise →"));
    press(choice(m, "A"));
    press(action(m, "See my score →"));
    expect(plain(m.container.querySelector("h2"))).toBe("2 out of 3");
    expect(plain(m.container)).toContain("1 answer to review.");
    expect(plain(m.container)).toContain("I still don’t understand");
    press(action(m, "Close the quiz"));
    expect(m.props.onExit).toHaveBeenCalledOnce();
  });

  it("leaves from the first exercise", () => {
    const m = mount({}, "en");
    press(action(m, "Leave the quiz"));
    expect(m.props.onExit).toHaveBeenCalledOnce();
  });
});
