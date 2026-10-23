import { createTranslator, NextIntlClientProvider, useLocale } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { describeRejection, type AskTranslate } from "@/components/ask/Rejection";
import { LevelChoice, LevelChoicePanel } from "@/components/explanation/LevelChoice";
import type { LevelRejection, LevelRequestView } from "@/components/explanation/level-request";
import { initialExplanationState } from "@/components/explanation/types";
import { messages } from "@/i18n/messages";

// next-intl's navigation module imports "next/navigation" without an extension, which plain
// Node ESM cannot resolve; the stand-in keeps the locale prefix the real Link adds.
vi.mock("@/i18n/navigation", () => ({
  Link: function Link({
    href,
    locale,
    ...props
  }: ComponentProps<"a"> & { href: string; locale?: string }) {
    const current = useLocale();
    return <a href={`/${locale ?? current}${href}`} {...props} />;
  },
}));

type Lang = "fr" | "en";

const NEW_ID = "kkkkkkkkkkk2";
const REFERENCE = { question: "la loi de la gravité" };

function within(locale: Lang, node: ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {node}
    </NextIntlClientProvider>,
  );
}

function referenceState(overrides: { level?: "college" | "lycee" | "superieur" } = {}) {
  return {
    ...initialExplanationState({
      question: "",
      language: "fr",
      level: overrides.level ?? "lycee",
    }),
    reference: REFERENCE,
  };
}

function panel(locale: Lang, view: LevelRequestView): string {
  return within(
    locale,
    <LevelChoicePanel
      language={locale}
      referenceLevel="lycee"
      view={view}
      onChoose={() => undefined}
    />,
  );
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(html: string): string {
  return normalize(
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;/g, "’")
      .replace(/&quot;/g, '"'),
  );
}

function region(html: string, role: "status" | "alert"): string {
  const match = new RegExp(`<div role="${role}"[^>]*>([\\s\\S]*?)</div>(?=<div role=|$|</div>)`);
  return match.exec(html)?.[1] ?? "";
}

function options(html: string): { type: string; pressed: boolean; text: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    type: /\btype="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? "",
    pressed: /aria-pressed="true"/.test(match[1] ?? ""),
    text: textOf(match[2] ?? ""),
  }));
}

const pressedOf = (html: string) => options(html).map((option) => option.pressed);

describe("LevelChoice: the choice of level", () => {
  it.each([
    ["fr", ["Collège", "Lycée [Référence]", "Supérieur"], "Expliquer à un autre niveau"],
    [
      "en",
      ["Middle school", "High school [Reference]", "Higher education"],
      "Explain at another level",
    ],
  ] as const)(
    "offers the three levels in %s as buttons and marks the one of the reference",
    (locale, texts, legend) => {
      const html = within(locale, <LevelChoice state={referenceState()} />);

      expect(options(html).map((option) => option.text)).toEqual(texts);
      expect(options(html).map((option) => option.type)).toEqual(["button", "button", "button"]);
      expect(pressedOf(html)).toEqual([false, true, false]);
      expect(html.match(/aria-pressed="(true|false)"/g)).toHaveLength(3);
      expect(html).not.toMatch(/<input\b|<fieldset\b|<legend\b|<form\b/);
      expect(html).not.toMatch(/type="(radio|submit)"/);

      const group = /<div role="group" aria-labelledby="([^"]+)"/.exec(html);
      expect(group).not.toBeNull();
      const caption = new RegExp(`<p id="${group![1]}"[^>]*>([\\s\\S]*?)</p>`).exec(html);
      expect(textOf(caption![1]!)).toBe(legend);
    },
  );

  it("marks another level when the reference was written for it", () => {
    const html = within("fr", <LevelChoice state={referenceState({ level: "superieur" })} />);
    expect(pressedOf(html)).toEqual([false, false, true]);
    expect(options(html).map((option) => option.text)).toEqual([
      "Collège",
      "Lycée",
      "Supérieur [Référence]",
    ]);
  });

  it.each(["fr", "en"] as const)(
    "shows nothing for an explanation that is not a reference, in %s",
    (locale) => {
      const state = { ...referenceState(), reference: null };
      expect(within(locale, <LevelChoice state={state} />)).toBe("");
    },
  );

  it("keeps the buttons at the size of a touch target", () => {
    const html = within("fr", <LevelChoice state={referenceState()} />);
    expect(html.match(/<button\b[^>]*class="[^"]*\btouch-target\b/g)).toHaveLength(3);
  });

  it("starts with an empty status region and no alert", () => {
    const html = within("fr", <LevelChoice state={referenceState()} />);
    expect(html).toContain('<div role="status" class="flex flex-col"></div>');
    expect(html).toContain('<div role="alert"></div>');
  });
});

describe("LevelChoicePanel: the preparation", () => {
  const COLLEGE = { kind: "preparing", level: "college" } as const;

  it.each([
    ["fr", "Préparation au niveau Collège…"],
    ["en", "Preparing for Middle school…"],
  ] as const)(
    "announces the preparation without progress in %s, with no link yet",
    (locale, sentence) => {
      const html = panel(locale, { ...COLLEGE, done: 0, total: null, openId: null });
      expect(textOf(region(html, "status"))).toBe(sentence);
      expect(html).not.toMatch(/<a\b/);
    },
  );

  it.each([
    [
      "fr",
      "Préparation au niveau Collège : 2 sur 6 scènes…",
      "Ouvrir au niveau Collège →",
      "/fr/e/",
    ],
    ["en", "Preparing for Middle school: 2 of 6 scenes…", "Open for Middle school →", "/en/e/"],
  ] as const)(
    "shows the progress in scenes and the link in %s",
    (locale, sentence, link, prefix) => {
      const html = panel(locale, { ...COLLEGE, done: 2, total: 6, openId: NEW_ID });
      const status = region(html, "status");

      expect(textOf(status)).toBe(`${sentence} ${link}`);
      const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(status)!;
      expect(/href="([^"]*)"/.exec(anchor[1]!)?.[1]).toBe(`${prefix}${NEW_ID}`);
      expect(textOf(anchor[2]!)).toBe(link);
    },
  );

  it("counts one scene in the singular", () => {
    const fr = panel("fr", { ...COLLEGE, done: 1, total: 1, openId: NEW_ID });
    const en = panel("en", { ...COLLEGE, done: 1, total: 1, openId: NEW_ID });
    expect(textOf(region(fr, "status"))).toContain("1 sur 1 scène…");
    expect(textOf(region(en, "status"))).toContain("1 of 1 scene…");
  });

  it.each([
    ["fr", "L’explication au niveau Supérieur est prête.", "Ouvrir au niveau Supérieur →"],
    ["en", "The explanation for Higher education is ready.", "Open for Higher education →"],
  ] as const)("says when the explanation is ready, in %s", (locale, sentence, link) => {
    const html = panel(locale, { kind: "ready", level: "superieur", openId: NEW_ID });
    expect(textOf(region(html, "status"))).toBe(`${sentence} ${link}`);
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });

  it("opens the explanation in its own language", () => {
    const html = within(
      "fr",
      <LevelChoicePanel
        language="en"
        referenceLevel="lycee"
        view={{ kind: "ready", level: "college", openId: NEW_ID }}
        onChoose={() => undefined}
      />,
    );
    expect(html).toContain(`href="/en/e/${NEW_ID}"`);
  });

  it("presses the level being prepared, then the one that is ready", () => {
    const preparing = panel("fr", { ...COLLEGE, done: 0, total: null, openId: null });
    const ready = panel("fr", { kind: "ready", level: "superieur", openId: NEW_ID });
    expect(pressedOf(preparing)).toEqual([true, false, false]);
    expect(pressedOf(ready)).toEqual([false, false, true]);
  });

  it("presses the reference again when nothing is prepared, whatever was refused", () => {
    const rejected = panel("fr", {
      kind: "rejected",
      level: "college",
      rejection: { kind: "rejected", code: "network", message: "" },
    });
    expect(pressedOf(panel("fr", { kind: "idle" }))).toEqual([false, true, false]);
    expect(pressedOf(rejected)).toEqual([false, true, false]);
  });
});

describe("LevelChoicePanel: the refusals", () => {
  function translator(locale: Lang): AskTranslate {
    return createTranslator({
      locale,
      messages: messages[locale],
      namespace: "Ask",
    }) as unknown as AskTranslate;
  }

  const CASES: [string, LevelRejection, (locale: Lang) => string][] = [
    [
      "a rate limit in seconds",
      { kind: "rejected", code: "rate_limited", message: "x", retryAfterSeconds: 12 },
      (locale) => messages[locale].Ask.errors.rateLimitedSeconds.replace(/\{.*\}/, "12"),
    ],
    [
      "an unavailable generation",
      { kind: "rejected", code: "generation_unavailable", message: "x" },
      (locale) => messages[locale].Ask.errors.generationUnavailable,
    ],
    [
      "an unreachable server",
      { kind: "rejected", code: "network", message: "" },
      (locale) => messages[locale].Ask.errors.unreachable,
    ],
  ];

  it.each(["fr", "en"] as const)("shows the message of describeRejection in %s", (locale) => {
    for (const [, rejection] of CASES) {
      const html = panel(locale, { kind: "rejected", level: "college", rejection });
      const expected = describeRejection(translator(locale), rejection).message;
      expect(expected).not.toBe("");
      expect(textOf(region(html, "alert"))).toBe(normalize(expected));
      expect(textOf(region(html, "status"))).toBe("");
    }
  });

  it.each(CASES)("translates %s into the language of the page", (_name, rejection, expected) => {
    for (const locale of ["fr", "en"] as const) {
      const html = panel(locale, { kind: "rejected", level: "college", rejection });
      const text = textOf(region(html, "alert"));
      if (rejection.code === "rate_limited") {
        expect(text).toContain(locale === "fr" ? "12 secondes" : "12 seconds");
      } else {
        expect(text).toBe(normalize(expected(locale)));
      }
    }
  });

  it("marks the alert with a filet and an icon, not with colour alone", () => {
    const html = panel("fr", {
      kind: "rejected",
      level: "college",
      rejection: { kind: "rejected", code: "network", message: "" },
    });
    const alert = region(html, "alert");
    expect(alert).toContain("border-role-action");
    expect(alert).toMatch(/<svg\b[^>]*aria-hidden="true"/);
  });
});
