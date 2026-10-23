// @vitest-environment jsdom
import { NextIntlClientProvider, useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GonePage } from "@/components/explanation/GonePage";
import { VisitorAsk } from "@/components/explanation/VisitorAsk";
import { messages } from "@/i18n/messages";

vi.mock("@/i18n/navigation", () => ({
  Link: function Link({ href, ...props }: ComponentProps<"a"> & { href: string }) {
    const current = useLocale();
    return <a href={`/${current}${href === "/" ? "" : href}`} {...props} />;
  },
}));

type Lang = "fr" | "en";

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

describe.each(["fr", "en"] as const)("GonePage in %s", (locale) => {
  const t = messages[locale].Share;

  it("explains an unknown explanation and offers to ask one's own question", () => {
    const page = render(locale, <GonePage kind="missing" />);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(text(page.querySelector("h1"))).toBe(t.missing.title);
    expect(text(page.querySelector("main"))).toContain(t.missing.lead);
    expect(text(page.querySelector("main"))).toContain(t.missing.next);
    const ask = [...page.querySelectorAll("main a")].find((link) => text(link) === t.ask);
    expect(ask?.getAttribute("href")).toBe(`/${locale}`);
  });

  it("says a shared link has expired, with the retention in days", () => {
    const page = render(locale, <GonePage kind="expired" />);
    expect(text(page.querySelector("h1"))).toBe(t.expired.title);
    expect(text(page.querySelector("main"))).toContain("90");
    expect(text(page.querySelector("main"))).toContain(t.expired.next);
    const ask = [...page.querySelectorAll("main a")].find((link) => text(link) === t.ask);
    expect(ask?.getAttribute("href")).toBe(`/${locale}`);
  });

  it("titles the document with the product name", () => {
    const title = render(locale, <GonePage kind="expired" />).querySelector("title");
    expect(text(title)).toBe(`${t.expired.title} — ${messages[locale].Common.productName}`);
  });

  it("has the skip-link target and no input zone", () => {
    const page = render(locale, <GonePage kind="expired" />);
    expect(page.querySelector("main#content")).not.toBeNull();
    expect(page.querySelector("textarea, input[type=text]")).toBeNull();
  });
});

describe("VisitorAsk", () => {
  it.each(["fr", "en"] as const)("leads home in %s", (locale) => {
    const page = render(locale, <VisitorAsk />);
    const link = page.querySelector("a");
    expect(text(link)).toBe(messages[locale].Share.ask);
    expect(link?.getAttribute("href")).toBe(`/${locale}`);
    expect(text(page.body)).toContain(messages[locale].Share.visitorLead);
    expect(page.querySelector("textarea, input")).toBeNull();
  });
});
