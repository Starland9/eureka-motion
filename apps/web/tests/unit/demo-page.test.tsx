// @vitest-environment jsdom
import { NextIntlClientProvider, useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoLink } from "@/components/ask/DemoLink";
import { DemoPage } from "@/components/demo/DemoPage";
import { messages } from "@/i18n/messages";

vi.mock("@/i18n/navigation", () => ({
  Link: function Link({ href, ...props }: ComponentProps<"a"> & { href: string }) {
    const current = useLocale();
    return <a href={`/${current}${href === "/" ? "" : href}`} {...props} />;
  },
}));

type Lang = "fr" | "en";

const VIDEO = "/demo/eureka-motion-demo.mp4";
const POSTER = "/demo/eureka-motion-demo.jpg";

const EXPECTED = {
  fr: {
    heading: "La démo en vidéo",
    intro:
      "Une question d’élève, un agent qui planifie, vérifie et anime l’explication. 1\u00a0min\u00a053, en français, sous-titrée.",
    label: "Vidéo de démonstration d’Eureka Motion",
    caption: "FIG. — DÉMONSTRATION · 1 MIN 53",
    back: "← Poser ma propre question",
    homeLink: "Voir la démo en vidéo (1 min 53) →",
  },
  en: {
    heading: "The demo on video",
    intro:
      "A student’s question, an agent that plans, checks and animates the explanation. 1\u00a0min\u00a053, in French, with French subtitles.",
    label: "Eureka Motion demo video",
    caption: "FIG. — DEMONSTRATION · 1 MIN 53",
    back: "← Ask my own question",
    homeLink: "Watch the demo video (1 min 53) →",
  },
} as const;

function render(locale: Lang, node: React.ReactNode): Document {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {node}
    </NextIntlClientProvider>,
  );
  return new DOMParser().parseFromString(html, "text/html");
}

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/[ \t\n\r]+/g, " ").trim();
}

describe.each(["fr", "en"] as const)("DemoPage in %s", (locale) => {
  const expected = EXPECTED[locale];

  it("has the skip-link target and a single main heading", () => {
    const page = render(locale, <DemoPage />);
    expect(page.querySelector("main#content")).not.toBeNull();
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(text(page.querySelector("h1"))).toBe(expected.heading);
  });

  it("introduces the video in one sentence", () => {
    const page = render(locale, <DemoPage />);
    expect(text(page.querySelector("main"))).toContain(expected.intro);
  });

  it("shows a native video with controls, metadata preload and the poster", () => {
    const video = render(locale, <DemoPage />).querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("playsinline")).toBe(true);
    expect(video?.getAttribute("poster")).toBe(POSTER);
  });

  it("never starts by itself", () => {
    const video = render(locale, <DemoPage />).querySelector("video");
    for (const name of ["autoplay", "loop", "muted"]) {
      expect(video?.hasAttribute(name), name).toBe(false);
    }
  });

  it("serves the MP4 as the only source", () => {
    const sources = [...render(locale, <DemoPage />).querySelectorAll("video source")];
    expect(sources).toHaveLength(1);
    expect(sources[0]?.getAttribute("src")).toBe(VIDEO);
    expect(sources[0]?.getAttribute("type")).toBe("video/mp4");
  });

  it("names the video for assistive technology", () => {
    const video = render(locale, <DemoPage />).querySelector("video");
    expect(video?.getAttribute("aria-label")).toBe(expected.label);
  });

  it("offers the MP4 download inside the video as a fallback", () => {
    const link = render(locale, <DemoPage />).querySelector("video a");
    expect(link?.getAttribute("href")).toBe(VIDEO);
    expect(link?.hasAttribute("download")).toBe(true);
  });

  it("puts the video in a figure with the monospace capitals caption", () => {
    const figure = render(locale, <DemoPage />).querySelector("figure");
    expect(figure?.querySelector("video")).not.toBeNull();
    const caption = figure?.querySelector("figcaption");
    expect(text(caption)).toBe(expected.caption);
    expect(caption?.className).toContain("text-caption");
  });

  it("frames the video with a 2 px ink rule, 16:9, full width, without rounding or shadow", () => {
    const classes = (render(locale, <DemoPage />).querySelector("video")?.className ?? "").split(
      /\s+/,
    );
    expect(classes).toEqual(
      expect.arrayContaining(["aspect-video", "w-full", "border-2", "border-ink"]),
    );
    expect(classes.filter((name) => /^(rounded|shadow)/.test(name))).toEqual([]);
  });

  it("links back to the home page of the same language", () => {
    const page = render(locale, <DemoPage />);
    const back = [...page.querySelectorAll("main a")].find((link) => text(link) === expected.back);
    expect(back?.getAttribute("href")).toBe(`/${locale}`);
  });
});

describe.each(["fr", "en"] as const)("DemoLink in %s", (locale) => {
  it("sends the home page to the demo page of the same language", () => {
    const link = render(locale, <DemoLink />).querySelector("a");
    expect(text(link)).toBe(EXPECTED[locale].homeLink);
    expect(link?.getAttribute("href")).toBe(`/${locale}/demo`);
  });

  it("is a secondary link: underlined, no filled button", () => {
    const classes = (render(locale, <DemoLink />).querySelector("a")?.className ?? "").split(/\s+/);
    expect(classes).toContain("underline");
    expect(classes).not.toContain("bg-ink");
  });

  it("carries one height and one padding, like the other secondary links", () => {
    const classes = (render(locale, <DemoLink />).querySelector("a")?.className ?? "").split(/\s+/);
    expect(classes.filter((name) => /^h-\d+$/.test(name))).toEqual(["h-11"]);
    expect(classes.filter((name) => /^px-\d+$/.test(name))).toEqual(["px-0"]);
  });
});
