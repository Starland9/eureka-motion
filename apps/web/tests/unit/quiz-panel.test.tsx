// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSchema, type Quiz as QuizDocument, type Scene } from "scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuizPanel } from "@/components/explanation/QuizPanel";
import {
  isFullyVisible,
  sceneNumbersOf,
  scenePositionOf,
} from "@/components/explanation/quiz-scenes";
import type { PlaybackControls } from "@/components/player/PlaybackProvider";
import { messages } from "@/i18n/messages";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const playback = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/components/player/PlaybackProvider", () => ({
  usePlayback: () => playback.current,
}));

const quiz: QuizDocument = DocumentSchema.parse(reference.payload).quiz!;

function scene(id: string, index: number): Scene {
  return { id, index } as Scene;
}

const SCENES = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id, index) => scene(id, index));

interface Fake {
  controls: Pick<
    PlaybackControls,
    "seekToScene" | "play" | "playerElement" | "reducedMotion" | "explanation"
  >;
  seekToScene: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
}

function fakePlayback(scenes: readonly Scene[] = SCENES, reducedMotion = false): Fake {
  const seekToScene = vi.fn();
  const play = vi.fn();
  const scrollIntoView = vi.fn();
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({ top: -400, bottom: -100 }) as DOMRect;
  element.scrollIntoView = scrollIntoView as unknown as typeof element.scrollIntoView;
  const controls = {
    seekToScene,
    play,
    playerElement: () => element,
    reducedMotion,
    explanation: { scenes, params: [], model: { constants: [], derived: [] } },
  } as unknown as Fake["controls"];
  playback.current = controls;
  return { controls, seekToScene, play, scrollIntoView };
}

const mounted: { root: Root; host: HTMLElement }[] = [];

function wrap(node: ReactNode): ReactNode {
  return (
    <NextIntlClientProvider locale="fr" messages={messages.fr}>
      {node}
    </NextIntlClientProvider>
  );
}

function panel(explanationId: string | null, withQuiz: QuizDocument | null = quiz): ReactNode {
  return (
    <QuizPanel quiz={withQuiz} explanationId={explanationId}>
      <p data-testid="scene-list">scenes</p>
    </QuizPanel>
  );
}

function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(wrap(node)));
  return { host, rerender: (next: ReactNode) => act(() => root.render(wrap(next))) };
}

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  playback.current = null;
});

function plain(node: Node | null | undefined): string {
  if (!node) return "";
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
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

function button(host: HTMLElement, name: string | RegExp): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    typeof name === "string" ? plain(item) === name : name.test(plain(item)),
  );
  if (!found) throw new Error(`no button ${String(name)}`);
  return found;
}

function press(element: HTMLElement): void {
  act(() => element.click());
}

const ENTRY = "Vérifier ce que j’ai compris";
const caption = (host: HTMLElement): string => plain(host.querySelector("p.text-caption"));
const hasScenes = (host: HTMLElement): boolean => host.querySelector("[data-testid]") !== null;

describe("the scene numbers of a quiz", () => {
  it("are the numbers the scene list gives", () => {
    expect(sceneNumbersOf(SCENES)).toEqual({ s1: 1, s2: 2, s3: 3, s4: 4, s5: 5, s6: 6 });
  });

  it("follow the planned slot when a scene was dropped", () => {
    expect(sceneNumbersOf([scene("s1", 0), scene("s3", 2), scene("s4", 3)])).toEqual({
      s1: 1,
      s3: 3,
      s4: 4,
    });
  });

  it("locate a scene by its position in the player", () => {
    expect(scenePositionOf(SCENES, "s3")).toBe(2);
    expect(scenePositionOf([scene("s1", 0), scene("s3", 2)], "s3")).toBe(1);
    expect(scenePositionOf(SCENES, "s9")).toBeNull();
  });

  it("tell whether the player is wholly in the window", () => {
    expect(isFullyVisible({ top: 10, bottom: 300 }, 700)).toBe(true);
    expect(isFullyVisible({ top: -1, bottom: 300 }, 700)).toBe(false);
    expect(isFullyVisible({ top: 10, bottom: 701 }, 700)).toBe(false);
  });
});

describe("the entry of the quiz", () => {
  it("is absent while there is no quiz", () => {
    fakePlayback();
    const m = mount(panel("e1", null));
    expect(hasScenes(m.host)).toBe(true);
    expect(m.host.querySelector("button")).toBeNull();
  });

  it("appears below the scene list once the quiz exists, without hiding the list", () => {
    fakePlayback();
    const m = mount(panel("e1", null));
    m.rerender(panel("e1"));
    expect(hasScenes(m.host)).toBe(true);
    const entry = button(m.host, ENTRY);
    expect(entry.compareDocumentPosition(m.host.querySelector("[data-testid]")!)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  it("is a native button, so the keyboard reaches it", () => {
    fakePlayback();
    const m = mount(panel("e1"));
    const entry = button(m.host, ENTRY);
    expect(entry.type).toBe("button");
    expect(entry.tabIndex).toBe(0);
  });
});

describe("the open quiz", () => {
  it("takes the place of the scene list and receives the focus on its question", () => {
    fakePlayback();
    const m = mount(panel("e1"));
    press(button(m.host, ENTRY));
    expect(hasScenes(m.host)).toBe(false);
    expect(caption(m.host)).toBe("Exercice 1 sur 3");
    expect(document.activeElement).toBe(m.host.querySelector("p[tabindex='-1']"));
  });

  it("gives the focus back to the entry when it is left", () => {
    fakePlayback();
    const m = mount(panel("e1"));
    press(button(m.host, ENTRY));
    press(button(m.host, "Quitter le quiz"));
    expect(hasScenes(m.host)).toBe(true);
    expect(document.activeElement).toBe(button(m.host, ENTRY));
  });

  it("keeps the answers given when it is left and shows the next exercise on return", () => {
    fakePlayback();
    const m = mount(panel("e1"));
    press(button(m.host, ENTRY));
    press(button(m.host, /^A est divisée par deux/));
    press(button(m.host, "Quitter le quiz"));
    press(button(m.host, ENTRY));
    expect(caption(m.host)).toBe("Exercice 2 sur 3");
  });

  it("shows the score on return when every question was answered", () => {
    fakePlayback();
    const m = mount(panel("e1"));
    press(button(m.host, ENTRY));
    press(button(m.host, /^B est divisée par quatre/));
    press(button(m.host, /^Exercice suivant/));
    press(button(m.host, /^C Elle attire la Terre avec la même force/));
    press(button(m.host, /^Exercice suivant/));
    press(button(m.host, /^B Elle est multipliée par quatre/));
    press(button(m.host, /^Voir mon score/));
    press(button(m.host, "Fermer le quiz"));
    press(button(m.host, ENTRY));
    expect(plain(m.host.querySelector("h2"))).toBe("2 sur 3");
  });

  it("starts again from nothing for another explanation", () => {
    fakePlayback();
    const m = mount(panel("e1"));
    press(button(m.host, ENTRY));
    press(button(m.host, /^A est divisée par deux/));
    m.rerender(panel("e2"));
    expect(hasScenes(m.host)).toBe(true);
    press(button(m.host, ENTRY));
    expect(caption(m.host)).toBe("Exercice 1 sur 3");
    expect(m.host.querySelector("[aria-disabled='true']")).toBeNull();
  });
});

describe("reviewing a scene", () => {
  function openOnWrongAnswer() {
    const m = mount(panel("e1"));
    press(button(m.host, ENTRY));
    press(button(m.host, /^A est divisée par deux/));
    return m;
  }

  it("puts the player on the start of the scene and plays it, the quiz staying open", () => {
    const fake = fakePlayback();
    const m = openOnWrongAnswer();
    press(button(m.host, "Revoir la scène 03 →"));
    expect(fake.seekToScene).toHaveBeenCalledExactlyOnceWith(2);
    expect(fake.play).toHaveBeenCalledOnce();
    expect(caption(m.host)).toBe("Exercice 1 sur 3");
    expect(m.host.querySelector("[aria-disabled='true']")).not.toBeNull();
  });

  it("brings the player into the window when it is out of it", () => {
    const fake = fakePlayback();
    const m = openOnWrongAnswer();
    press(button(m.host, "Revoir la scène 03 →"));
    expect(fake.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("leaves the window alone when the player is already wholly shown", () => {
    const fake = fakePlayback();
    fake.controls.playerElement = () => {
      const element = document.createElement("div");
      element.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
      element.scrollIntoView = fake.scrollIntoView as unknown as typeof element.scrollIntoView;
      return element;
    };
    const m = openOnWrongAnswer();
    press(button(m.host, "Revoir la scène 03 →"));
    expect(fake.seekToScene).toHaveBeenCalledOnce();
    expect(fake.scrollIntoView).not.toHaveBeenCalled();
  });

  it("stays paused and scrolls without animation when motion is reduced", () => {
    const fake = fakePlayback(SCENES, true);
    const m = openOnWrongAnswer();
    press(button(m.host, "Revoir la scène 03 →"));
    expect(fake.seekToScene).toHaveBeenCalledExactlyOnceWith(2);
    expect(fake.play).not.toHaveBeenCalled();
    expect(fake.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "center",
      behavior: "auto",
    });
  });

  it("does nothing for a scene the player does not have", () => {
    const fake = fakePlayback([scene("s1", 0), scene("s2", 1)]);
    const m = openOnWrongAnswer();
    press(button(m.host, "Revoir la scène →"));
    expect(fake.seekToScene).not.toHaveBeenCalled();
    expect(fake.play).not.toHaveBeenCalled();
  });
});
