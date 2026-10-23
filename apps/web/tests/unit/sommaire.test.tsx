import { NextIntlClientProvider, useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  REFERENCE_SUBJECTS,
  Sommaire,
  type ReferenceEntry,
  type ReferenceSubject,
} from "@/components/ask/Sommaire";
import { messages } from "@/i18n/messages";

// next-intl's navigation module imports "next/navigation" without an extension, which plain
// Node ESM cannot resolve; the stand-in keeps the locale prefix the real Link adds.
vi.mock("@/i18n/navigation", () => ({
  Link: function Link({ href, ...props }: ComponentProps<"a"> & { href: string }) {
    return <a href={`/${useLocale()}${href}`} {...props} />;
  },
}));

const TITLES: Record<ReferenceSubject, readonly [string, string]> = {
  maths: ["Théorème de Pythagore", "La dérivée"],
  physics: ["La gravitation universelle", "Loi d’Ohm"],
  chemistry: ["Équation chimique", "Le pH"],
  biology: ["La photosynthèse", "De l’ADN à la protéine"],
  cs: ["Le tri à bulles", "La recherche dichotomique"],
  economics: ["L’offre et la demande", "Les intérêts composés"],
};

const LEVELS = ["college", "lycee", "superieur"] as const;

const ENTRIES: ReferenceEntry[] = REFERENCE_SUBJECTS.flatMap((subject, s) =>
  TITLES[subject].map((title, i) => ({
    slug: `${subject}/concept-${i + 1}`,
    subject,
    title,
    reference_level: LEVELS[(s + i) % LEVELS.length]!,
    explanation_id: `ref-${subject}-${i + 1}`,
  })),
);

function render(locale: "fr" | "en", entries: readonly ReferenceEntry[] = ENTRIES): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <Sommaire entries={entries} />
    </NextIntlClientProvider>,
  );
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(html: string): string {
  return normalize(html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "’"));
}

function anchors(html: string): { attributes: string; text: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    attributes: match[1] ?? "",
    text: textOf(match[2] ?? ""),
  }));
}

function href(attributes: string): string {
  return /href="([^"]*)"/.exec(attributes)?.[1] ?? "";
}

describe("Sommaire", () => {
  it.each(["fr", "en"] as const)(
    "renders six subject groups in %s, each with a heading",
    (locale) => {
      const html = render(locale);
      const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => textOf(m[1]!));
      const labels = messages[locale].Ask.sommaire.subjects;
      expect(headings).toEqual(REFERENCE_SUBJECTS.map((subject) => labels[subject]));
      expect(html.match(/<section\b/g)).toHaveLength(1 + REFERENCE_SUBJECTS.length);
      expect(html.match(/<h2\b/g)).toHaveLength(1);
      expect(textOf(html)).toContain(messages[locale].Ask.sommaire.title);
    },
  );

  it("makes every line a link to its explanation, and nothing else is focusable", () => {
    const html = render("fr");
    const links = anchors(html);
    expect(links).toHaveLength(ENTRIES.length);
    expect(links.map((link) => href(link.attributes))).toEqual(
      ENTRIES.map((entry) => `/fr/e/${entry.explanation_id}`),
    );
    expect(html.match(/<li\b/g)).toHaveLength(ENTRIES.length);
    expect(html).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(html).not.toMatch(/tabindex/i);
  });

  it("keeps the tab order identical to the reading order: subjects, then concepts as given", () => {
    const html = render("fr");
    const order = anchors(html).map((link) => href(link.attributes));
    expect(order).toEqual(ENTRIES.map((entry) => `/fr/e/${entry.explanation_id}`));

    const headingAt = [...html.matchAll(/<h3\b/g)].map((match) => match.index!);
    const linkAt = [...html.matchAll(/<a\b/g)].map((match) => match.index!);
    headingAt.forEach((position, group) => {
      const next = headingAt[group + 1] ?? Infinity;
      expect(linkAt.filter((at) => at > position && at < next)).toHaveLength(2);
    });
  });

  it("orders the groups as the six subjects, whatever the order of the entries", () => {
    const shuffled = [...ENTRIES].reverse();
    const html = render("fr", shuffled);
    const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => textOf(m[1]!));
    expect(headings).toEqual(
      REFERENCE_SUBJECTS.map((subject) => messages.fr.Ask.sommaire.subjects[subject]),
    );
    const first = anchors(html)[0]!;
    expect(href(first.attributes)).toBe("/fr/e/ref-maths-2");
  });

  it("names each link with its concept and its reference level", () => {
    const [first] = anchors(render("fr"));
    expect(first!.text).toBe(
      normalize(
        `Théorème de Pythagore ${messages.fr.Ask.sommaire.levelIntro} ${messages.fr.Level.college}`,
      ),
    );
    const [firstEn] = anchors(render("en"));
    expect(firstEn!.text).toBe(
      normalize(
        `Théorème de Pythagore ${messages.en.Ask.sommaire.levelIntro} ${messages.en.Level.college}`,
      ),
    );
    expect(href(firstEn!.attributes)).toBe("/en/e/ref-maths-1");
  });

  it.each(["fr", "en"] as const)("shows the level of each entry in %s", (locale) => {
    const levels = messages[locale].Level;
    const texts = anchors(render(locale)).map((link) => link.text);
    ENTRIES.forEach((entry, index) => {
      expect(texts[index]).toBe(
        normalize(
          `${entry.title} ${messages[locale].Ask.sommaire.levelIntro} ${levels[entry.reference_level]}`,
        ),
      );
    });
  });

  it("carries no card, no decorative icon and no hard-coded text", () => {
    const html = render("fr");
    expect(html).not.toMatch(/<(svg|img|picture|canvas|button)\b/);
    expect(html).not.toMatch(/rounded|shadow|gradient|blur|ring-|bg-surface-raised|bg-white|p-6/);
    const visible = textOf(html);
    const allowed = [
      messages.fr.Ask.sommaire.title,
      messages.fr.Ask.sommaire.intro,
      messages.fr.Ask.sommaire.levelIntro,
      ...REFERENCE_SUBJECTS.map((subject) => messages.fr.Ask.sommaire.subjects[subject]),
      ...Object.values(messages.fr.Level),
      ...ENTRIES.map((entry) => entry.title),
    ];
    let remaining = visible;
    for (const part of allowed) remaining = remaining.split(normalize(part)).join("");
    expect(remaining.replace(/\s+/g, "")).toBe("");
  });

  it("hides the leader dots from assistive technology", () => {
    const html = render("fr");
    const leaders = html.match(/<span aria-hidden="true"[^>]*border-dotted[^>]*><\/span>/g);
    expect(leaders).toHaveLength(ENTRIES.length);
  });

  it("lays out one column on a phone and two from the tablet width", () => {
    const html = render("fr");
    expect(html).toContain("md:columns-2");
    expect(html).not.toMatch(/(^|[ "])columns-/);
  });

  it("skips subjects without entries and renders nothing when the list is empty", () => {
    const onlyMaths = ENTRIES.filter((entry) => entry.subject === "maths");
    const html = render("fr", onlyMaths);
    expect(html.match(/<h3\b/g)).toHaveLength(1);
    expect(anchors(html)).toHaveLength(2);
    expect(render("fr", [])).toBe("");
  });
});
