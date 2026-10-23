// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_MAX_LENGTH, FollowUp, type FollowUpProps } from "@/components/controls/FollowUp";
import { Reformulate, type ReformulateProps } from "@/components/controls/Reformulate";
import { Versions, type VersionEntry, type VersionsProps } from "@/components/controls/Versions";
import { messages } from "@/i18n/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lang = "fr" | "en";

const SCENES = [
  { id: "s1", title: "Accroche" },
  { id: "s2", title: "Intuition" },
  { id: "s3", title: "La force" },
  { id: "s4", title: "Le calcul" },
];

const VERSIONS: VersionEntry[] = [
  { id: "v1", kind: "initial" },
  { id: "v2", kind: "another_analogy" },
  { id: "v3", kind: "simpler" },
  { id: "v4", kind: "zoom", scene: "La force" },
  { id: "v5", kind: "followup" },
];

const mounted: { root: Root; host: HTMLElement }[] = [];

function wrap(locale: Lang, node: ReactNode): ReactNode {
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {node}
    </NextIntlClientProvider>
  );
}

function mount(node: ReactNode, locale: Lang = "fr") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(wrap(locale, node)));
  return {
    host,
    rerender: (next: ReactNode) => act(() => root.render(wrap(locale, next))),
  };
}

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

function plain(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buttons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")];
}

function press(key: string, target: Element): void {
  for (const type of ["keydown", "keyup"]) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
    });
  }
}

function typeInto(field: HTMLTextAreaElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(field: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    field.dispatchEvent(event);
  });
  return event;
}

function reformulateProps(extra: Partial<ReformulateProps> = {}): ReformulateProps {
  return {
    scenes: SCENES,
    activeSceneId: "s3",
    busy: false,
    onReformulate: vi.fn(),
    onZoom: vi.fn(),
    ...extra,
  };
}

function followUpProps(extra: Partial<FollowUpProps> = {}): FollowUpProps {
  return { busy: false, onAsk: vi.fn(), ...extra };
}

function versionsProps(extra: Partial<VersionsProps> = {}): VersionsProps {
  return { versions: VERSIONS, currentId: "v1", onOpen: vi.fn(), ...extra };
}

const LANGS: Lang[] = ["fr", "en"];

describe("Reformulate", () => {
  it.each(LANGS)("offers the three choices as one segmented row of buttons in %s", (locale) => {
    const t = messages[locale].Reformulate;
    const { host } = mount(<Reformulate {...reformulateProps()} />, locale);

    expect(plain(host.querySelector("h2")?.textContent)).toBe(plain(t.title));
    const choices = buttons(host);
    expect(choices.map((button) => button.type)).toEqual(["button", "button", "button"]);
    expect(choices.map((button) => plain(button.firstChild?.textContent))).toEqual([
      plain(t.choices.another_analogy),
      plain(t.choices.simpler),
      plain(t.choices.zoom),
    ]);
    const row = choices[0]!.parentElement!;
    expect(choices.every((button) => button.parentElement === row)).toBe(true);
    expect(row.className).toContain("divide-ink");
    expect(host.querySelector("section")?.getAttribute("aria-labelledby")).toBe(
      host.querySelector("h2")?.id,
    );
  });

  it.each(LANGS)("recalls the designated scene in the zoom choice in %s", (locale) => {
    const { host } = mount(<Reformulate {...reformulateProps()} />, locale);
    const zoom = buttons(host)[2]!;
    expect(plain(zoom.textContent)).toBe(
      plain(`${messages[locale].Reformulate.choices.zoom} 03 — La force`),
    );
    expect(plain(buttons(host)[0]!.textContent)).not.toContain("La force");
  });

  it.each(LANGS)(
    "lists every scene in a labelled select, the active one selected in %s",
    (locale) => {
      const t = messages[locale].Reformulate;
      const { host } = mount(<Reformulate {...reformulateProps()} />, locale);
      const select = host.querySelector("select")!;
      expect(select.labels?.[0]?.textContent).toBe(t.sceneLegend);
      expect([...select.options].map((option) => plain(option.textContent))).toEqual([
        "01 — Accroche",
        "02 — Intuition",
        "03 — La force",
        "04 — Le calcul",
      ]);
      expect(select.value).toBe("s3");
    },
  );

  it("sends the request of each choice on click, and nothing else", () => {
    const props = reformulateProps();
    const { host } = mount(<Reformulate {...props} />);
    const [analogy, simpler, zoom] = buttons(host) as [
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
    ];

    act(() => analogy.click());
    expect(props.onReformulate).toHaveBeenLastCalledWith("another_analogy");
    act(() => simpler.click());
    expect(props.onReformulate).toHaveBeenLastCalledWith("simpler");
    expect(props.onReformulate).toHaveBeenCalledTimes(2);
    expect(props.onZoom).not.toHaveBeenCalled();

    act(() => zoom.click());
    expect(props.onZoom).toHaveBeenCalledTimes(1);
    expect(props.onZoom).toHaveBeenCalledWith("s3");
    expect(props.onReformulate).toHaveBeenCalledTimes(2);
  });

  it("zooms on the scene the student designates, not on the active one", () => {
    const props = reformulateProps();
    const { host } = mount(<Reformulate {...props} />);
    const select = host.querySelector("select")!;

    act(() => {
      select.value = "s2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(props.onZoom).not.toHaveBeenCalled();
    expect(plain(buttons(host)[2]!.textContent)).toContain("02 — Intuition");

    act(() => buttons(host)[2]!.click());
    expect(props.onZoom).toHaveBeenCalledWith("s2");
  });

  it("follows the active scene until the student designates one, then keeps the choice", () => {
    const { host, rerender } = mount(
      <Reformulate {...reformulateProps({ activeSceneId: "s1" })} />,
    );
    expect(plain(buttons(host)[2]!.textContent)).toContain("01 — Accroche");

    rerender(<Reformulate {...reformulateProps({ activeSceneId: "s4" })} />);
    expect(plain(buttons(host)[2]!.textContent)).toContain("04 — Le calcul");

    const select = host.querySelector("select")!;
    act(() => {
      select.value = "s2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    rerender(<Reformulate {...reformulateProps({ activeSceneId: "s1" })} />);
    expect(plain(buttons(host)[2]!.textContent)).toContain("02 — Intuition");
  });

  it("never sends a request on a key other than the activation keys", () => {
    const props = reformulateProps();
    const { host } = mount(<Reformulate {...props} />);
    const targets = [...buttons(host), host.querySelector("select")!];
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "Tab", "a"];
    for (const target of targets) {
      act(() => target.focus());
      for (const key of keys) press(key, target);
    }
    expect(props.onReformulate).not.toHaveBeenCalled();
    expect(props.onZoom).not.toHaveBeenCalled();
  });

  it.each(LANGS)("disables the choices with a spoken reason while busy in %s", (locale) => {
    const t = messages[locale].Reformulate;
    const props = reformulateProps({ busy: true });
    const { host } = mount(<Reformulate {...props} />, locale);

    const choices = buttons(host);
    expect(choices.every((button) => button.disabled)).toBe(true);
    const status = host.querySelector('[role="status"]')!;
    expect(plain(status.textContent)).toBe(plain(t.busy));
    for (const button of choices) {
      expect(button.getAttribute("aria-describedby")).toBe(status.id);
      act(() => button.click());
    }
    expect(props.onReformulate).not.toHaveBeenCalled();
    expect(props.onZoom).not.toHaveBeenCalled();
  });

  it("says nothing and enables everything when not busy", () => {
    const { host } = mount(<Reformulate {...reformulateProps()} />);
    expect(buttons(host).every((button) => !button.disabled)).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("");
    expect(host.querySelector("[aria-describedby]")).toBeNull();
  });

  it.each([
    ["no active scene", { activeSceneId: null }],
    ["an unknown active scene", { activeSceneId: "gone" }],
    ["no scene at all", { scenes: [], activeSceneId: "s3" }],
  ] satisfies [string, Partial<ReformulateProps>][])(
    "requires a designated scene for the zoom: %s",
    (_name, extra) => {
      const props = reformulateProps(extra);
      const { host } = mount(<Reformulate {...props} />);
      const [analogy, simpler, zoom] = buttons(host) as HTMLButtonElement[];
      expect(analogy!.disabled).toBe(false);
      expect(simpler!.disabled).toBe(false);
      expect(zoom!.disabled).toBe(true);
      expect(plain(zoom!.textContent)).toBe(plain(messages.fr.Reformulate.choices.zoom));
      const note = host.querySelector(`#${CSS.escape(zoom!.getAttribute("aria-describedby")!)}`);
      expect(plain(note?.textContent)).toBe(plain(messages.fr.Reformulate.zoomNeedsScene));
      expect(host.querySelector("select")!.value).toBe("");
      act(() => zoom!.click());
      expect(props.onZoom).not.toHaveBeenCalled();
    },
  );

  it("lets the student designate a scene when none is active, which enables the zoom", () => {
    const props = reformulateProps({ activeSceneId: null });
    const { host } = mount(<Reformulate {...props} />);
    const select = host.querySelector("select")!;
    act(() => {
      select.value = "s4";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(buttons(host)[2]!.disabled).toBe(false);
    expect(host.querySelector("option[value='']")).toBeNull();
    act(() => buttons(host)[2]!.click());
    expect(props.onZoom).toHaveBeenCalledWith("s4");
  });

  it("shows a refusal in the alert region and nothing otherwise", () => {
    const { host, rerender } = mount(<Reformulate {...reformulateProps()} />);
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("");
    rerender(
      <Reformulate
        {...reformulateProps({ rejection: { message: "Trop de questions.", degraded: false } })}
      />,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Trop de questions.");
  });

  it.each(LANGS)("carries no text of its own outside the translation files in %s", (locale) => {
    const t = messages[locale].Reformulate;
    const html = renderToStaticMarkup(wrap(locale, <Reformulate {...reformulateProps()} />));
    const visible = plain(html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "’"));
    const allowed = [
      t.title,
      t.choices.another_analogy,
      t.choices.simpler,
      t.choices.zoom,
      t.sceneLegend,
      "03 — La force",
      "01 — Accroche",
      "02 — Intuition",
      "04 — Le calcul",
    ];
    let remaining = visible;
    for (const part of allowed) remaining = remaining.split(plain(part)).join("");
    expect(remaining.replace(/\s+/g, "")).toBe("");
    expect(html).not.toMatch(/<(svg|img|canvas)\b/);
    expect(html).not.toMatch(/rounded|shadow|gradient|blur/);
  });

  it("gives every control a touch target and a visible name", () => {
    const { host } = mount(<Reformulate {...reformulateProps()} />);
    for (const button of buttons(host)) {
      expect(button.className).toContain("touch-target");
      expect(plain(button.textContent)).not.toBe("");
    }
    expect(host.querySelector("select")?.className).toContain("touch-target");
  });
});

describe("FollowUp", () => {
  const SENTENCE = "la distance double";

  it.each(LANGS)("composes the sentence with a blank to fill in %s", (locale) => {
    const t = messages[locale].Reformulate.followUp;
    const { host } = mount(<FollowUp {...followUpProps()} />, locale);
    const field = host.querySelector("textarea")!;

    expect(field.labels).toHaveLength(1);
    expect(plain(field.labels![0]!.textContent)).toBe(t.lead);
    expect(field.placeholder).toBe(t.placeholder);
    expect(field.maxLength).toBe(FOLLOW_UP_MAX_LENGTH);
    expect(FOLLOW_UP_MAX_LENGTH).toBe(500);
    expect(plain(host.querySelector("[aria-hidden='true']:not(div)")?.textContent)).toBe(t.tail);
    const submit = host.querySelector<HTMLButtonElement>("button[type='submit']")!;
    expect(plain(submit.textContent)).toBe(plain(t.submit));
    expect(submit.disabled).toBe(true);
    expect(plain(host.textContent)).toContain(plain(t.hint));
  });

  it.each(LANGS)("sends the cleaned question on Enter in %s", (locale) => {
    const props = followUpProps();
    const { host } = mount(<FollowUp {...props} />, locale);
    const field = host.querySelector("textarea")!;

    typeInto(field, `  et si \n ${SENTENCE}  \t `);
    const event = pressEnter(field);

    expect(event.defaultPrevented).toBe(true);
    expect(props.onAsk).toHaveBeenCalledTimes(1);
    expect(props.onAsk).toHaveBeenCalledWith(`et si ${SENTENCE}`);
  });

  it("sends the question when the button is pressed", () => {
    const props = followUpProps();
    const { host } = mount(<FollowUp {...props} />);
    const field = host.querySelector("textarea")!;
    const submit = host.querySelector<HTMLButtonElement>("button[type='submit']")!;

    typeInto(field, SENTENCE);
    expect(submit.disabled).toBe(false);
    act(() => submit.click());

    expect(props.onAsk).toHaveBeenCalledTimes(1);
    expect(props.onAsk).toHaveBeenCalledWith(SENTENCE);
  });

  it("sends nothing from an empty or blank field", () => {
    const props = followUpProps();
    const { host } = mount(<FollowUp {...props} />);
    const field = host.querySelector("textarea")!;
    const submit = host.querySelector<HTMLButtonElement>("button[type='submit']")!;

    pressEnter(field);
    typeInto(field, "  \n\t  ");
    pressEnter(field);
    expect(submit.disabled).toBe(true);
    act(() => submit.click());
    act(() => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(props.onAsk).not.toHaveBeenCalled();
  });

  it("does not send on Shift+Enter, on a composition Enter, or on any other key", () => {
    const props = followUpProps();
    const { host } = mount(<FollowUp {...props} />);
    const field = host.querySelector("textarea")!;
    typeInto(field, SENTENCE);

    pressEnter(field, { shiftKey: true });
    pressEnter(field, { isComposing: true });
    for (const key of ["ArrowRight", "ArrowDown", "Tab", " ", "Escape", "a"]) press(key, field);

    expect(props.onAsk).not.toHaveBeenCalled();
  });

  it.each(LANGS)("holds the request back while busy, keeping the text, in %s", (locale) => {
    const t = messages[locale].Reformulate.followUp;
    const props = followUpProps({ busy: true });
    const { host, rerender } = mount(<FollowUp {...props} />, locale);
    const field = host.querySelector("textarea")!;
    const submit = host.querySelector<HTMLButtonElement>("button[type='submit']")!;

    typeInto(field, SENTENCE);
    pressEnter(field);
    expect(submit.disabled).toBe(true);
    act(() => submit.click());
    expect(props.onAsk).not.toHaveBeenCalled();
    expect(field.value).toBe(SENTENCE);

    const status = host.querySelector('[role="status"]')!;
    expect(plain(status.textContent)).toBe(plain(t.busy));
    expect(submit.getAttribute("aria-describedby")).toBe(status.id);

    rerender(<FollowUp {...props} busy={false} />);
    expect(submit.disabled).toBe(false);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("");
    pressEnter(field);
    expect(props.onAsk).toHaveBeenCalledWith(SENTENCE);
  });

  it.each(LANGS)("counts the remaining characters only near the limit in %s", (locale) => {
    const { host } = mount(<FollowUp {...followUpProps()} />, locale);
    const field = host.querySelector("textarea")!;
    const note = host.querySelector(
      `#${CSS.escape(field.getAttribute("aria-describedby")!.split(" ")[1]!)}`,
    )!;

    typeInto(field, "a".repeat(FOLLOW_UP_MAX_LENGTH - 51));
    expect(note.textContent).toBe("");
    typeInto(field, "a".repeat(FOLLOW_UP_MAX_LENGTH - 50));
    expect(plain(note.textContent)).toBe(
      plain(locale === "fr" ? "Il reste 50 caractères" : "50 characters left"),
    );
    typeInto(field, "a".repeat(FOLLOW_UP_MAX_LENGTH));
    expect(plain(note.textContent)).toBe(
      plain(locale === "fr" ? "Il reste 0 caractère" : "0 characters left"),
    );
  });

  it("sends a question of exactly the maximum length whole", () => {
    const props = followUpProps();
    const { host } = mount(<FollowUp {...props} />);
    const question = "a".repeat(FOLLOW_UP_MAX_LENGTH);
    typeInto(host.querySelector("textarea")!, question);
    pressEnter(host.querySelector("textarea")!);
    expect(props.onAsk).toHaveBeenCalledWith(question);
  });

  it("flags a refusal on the field and in the alert region", () => {
    const { host, rerender } = mount(<FollowUp {...followUpProps()} />);
    const field = host.querySelector("textarea")!;
    expect(field.getAttribute("aria-invalid")).toBe("false");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("");

    rerender(
      <FollowUp
        {...followUpProps({ rejection: { message: "Trop de questions.", degraded: false } })}
      />,
    );
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Trop de questions.");
    expect(field.getAttribute("aria-describedby")).toContain(alert.id);
  });
});

describe("Versions", () => {
  it.each([
    ["fr", ["V1", "V2 — autre image", "V3 — plus simple", "V4 — zoom : La force", "V5 — suivi"]],
    ["en", ["V1", "V2 — another image", "V3 — simpler", "V4 — zoom: La force", "V5 — follow-up"]],
  ] as const)("labels the versions of the session in %s", (locale, expected) => {
    const { host } = mount(<Versions {...versionsProps({ currentId: null })} />, locale);
    const labels = [...host.querySelectorAll("li button")].map((button) =>
      plain(button.textContent),
    );
    expect(labels).toEqual([...expected]);
    const list = host.querySelector("ol")!;
    expect(
      plain(
        host.querySelector(`#${CSS.escape(list.getAttribute("aria-labelledby")!)}`)?.textContent,
      ),
    ).toBe(plain(messages[locale].Reformulate.versions.label));
  });

  it("names a zoom after its kind alone when the scene is not known", () => {
    const { host } = mount(
      <Versions {...versionsProps({ versions: [VERSIONS[0]!, { id: "z", kind: "zoom" }] })} />,
    );
    expect(plain(host.querySelectorAll("li button")[1]!.textContent)).toBe("V2 — zoom");
  });

  it.each(LANGS)("marks the displayed version, and only it, in %s", (locale) => {
    const { host, rerender } = mount(<Versions {...versionsProps({ currentId: "v3" })} />, locale);
    const items = [...host.querySelectorAll("li button")];
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
      null,
      null,
    ]);
    expect(plain(items[2]!.textContent)).toContain(
      plain(messages[locale].Reformulate.versions.current),
    );
    expect(
      items.filter((item) =>
        item.textContent?.includes(messages[locale].Reformulate.versions.current),
      ),
    ).toHaveLength(1);

    rerender(<Versions {...versionsProps({ currentId: "unknown" })} />);
    expect(host.querySelector("[aria-current]")).toBeNull();
  });

  it.each([[[]], [[VERSIONS[0]!]]] as const)("renders nothing for %j", (versions) => {
    const { host } = mount(<Versions {...versionsProps({ versions, currentId: "v1" })} />);
    expect(host.innerHTML).toBe("");
  });

  it("appears from the second version on", () => {
    const { host } = mount(<Versions {...versionsProps({ versions: VERSIONS.slice(0, 2) })} />);
    expect(host.querySelectorAll("li")).toHaveLength(2);
  });

  it("replays any version, the displayed one included, and only on activation", () => {
    const props = versionsProps({ currentId: "v2" });
    const { host } = mount(<Versions {...props} />);
    const items = [...host.querySelectorAll<HTMLButtonElement>("li button")];

    for (const item of items) {
      act(() => item.focus());
      for (const key of ["ArrowRight", "ArrowDown", "Home", "End"]) press(key, item);
    }
    expect(props.onOpen).not.toHaveBeenCalled();

    for (const item of items) act(() => item.click());
    expect(vi.mocked(props.onOpen).mock.calls.map(([id]) => id)).toEqual(
      VERSIONS.map((version) => version.id),
    );
  });

  it("makes each version a button of at least a touch target, with no bubble", () => {
    const { host } = mount(<Versions {...versionsProps()} />);
    const items = [...host.querySelectorAll<HTMLButtonElement>("li button")];
    expect(items.every((item) => item.type === "button")).toBe(true);
    expect(items.every((item) => item.className.includes("touch-target"))).toBe(true);
    expect(host.innerHTML).not.toMatch(/rounded|shadow|gradient|blur|<svg|<img/);
  });
});

describe("one explanation at a time", () => {
  function Session() {
    const [shown, setShown] = useState("v1");
    const [versions, setVersions] = useState<VersionEntry[]>([VERSIONS[0]!]);
    return (
      <>
        <article data-testid="shown">{shown}</article>
        <Reformulate
          key={shown}
          scenes={SCENES}
          activeSceneId="s2"
          busy={false}
          onReformulate={(mode) => {
            const id = `v${versions.length + 1}`;
            setVersions([...versions, { id, kind: mode }]);
            setShown(id);
          }}
          onZoom={(sceneId) => {
            const id = `v${versions.length + 1}`;
            const scene = SCENES.find((candidate) => candidate.id === sceneId)?.title;
            setVersions([...versions, { id, kind: "zoom", ...(scene ? { scene } : {}) }]);
            setShown(id);
          }}
        />
        <FollowUp
          key={`followup-${shown}`}
          busy={false}
          onAsk={() => {
            const id = `v${versions.length + 1}`;
            setVersions([...versions, { id, kind: "followup" }]);
            setShown(id);
          }}
        />
        <Versions versions={versions} currentId={shown} onOpen={setShown} />
      </>
    );
  }

  it("shows a single explanation, lists every version once there are two, and replays each", () => {
    const { host } = mount(<Session />);
    const shown = () => host.querySelectorAll('[data-testid="shown"]');
    const list = () => [...host.querySelectorAll<HTMLButtonElement>("ol li button")];

    expect(list()).toHaveLength(0);
    act(() => buttons(host)[0]!.click());
    act(() => buttons(host)[1]!.click());
    act(() => buttons(host)[2]!.click());

    const field = host.querySelector("textarea")!;
    typeInto(field, "la distance double");
    pressEnter(field);

    expect(list().map((item) => plain(item.textContent))).toEqual([
      "V1",
      "V2 — autre image",
      "V3 — plus simple",
      "V4 — zoom : Intuition",
      "V5 — suivi [Affichée]",
    ]);
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.textContent).toBe("v5");
    expect(host.querySelector("textarea")!.value).toBe("");

    for (const [index, id] of ["v1", "v2", "v3", "v4", "v5"].entries()) {
      act(() => list()[index]!.click());
      expect(shown()).toHaveLength(1);
      expect(shown()[0]!.textContent).toBe(id);
      const current = list().filter((item) => item.getAttribute("aria-current") === "true");
      expect(current).toHaveLength(1);
      expect(current[0]).toBe(list()[index]);
    }
  });
});
