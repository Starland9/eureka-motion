import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoiceCredit } from "@/components/ask/VoiceCredit";
import { messages } from "@/i18n/messages";

const MODEL_URL = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
const VOICES_URL = "https://huggingface.co/kyutai/tts-voices";

const CREDITS = {
  fr: "Voix de synthèse : Pocket TTS, un modèle de Kyutai, sous licence CC BY 4.0. Voix anglaise : Alba MacKenna, licence CC BY 4.0.",
  en: "Synthetic voice: Pocket TTS, a model by Kyutai, licensed under CC BY 4.0. English voice: Alba MacKenna, licensed under CC BY 4.0.",
} as const;

const LABELS = { fr: "Voix", en: "Voice" } as const;

function render(locale: "fr" | "en", configured: boolean): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <VoiceCredit configured={configured} />
    </NextIntlClientProvider>,
  );
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((match) => textOf(match[1] ?? ""));
}

function anchors(html: string): { attributes: string; text: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    attributes: match[1] ?? "",
    text: match[2] ?? "",
  }));
}

describe("VoiceCredit", () => {
  it.each(["fr", "en"] as const)("renders nothing without the Pocket voice in %s", (locale) => {
    expect(render(locale, false)).toBe("");
  });

  it.each(["fr", "en"] as const)("shows the credit text and label in %s", (locale) => {
    expect(paragraphs(render(locale, true))).toEqual([LABELS[locale], CREDITS[locale]]);
  });

  it.each(["fr", "en"] as const)("links the model, the licence and the voice in %s", (locale) => {
    const links = anchors(render(locale, true));
    expect(links.map((link) => link.text)).toEqual([
      "Pocket TTS",
      "CC BY 4.0",
      "Alba MacKenna",
      "CC BY 4.0",
    ]);
    const hrefs = links.map((link) => /href="([^"]*)"/.exec(link.attributes)?.[1]);
    expect(hrefs).toEqual([MODEL_URL, LICENCE_URL, VOICES_URL, LICENCE_URL]);
  });

  it("opens the links in a new tab without leaking the opener", () => {
    for (const link of anchors(render("en", true))) {
      expect(link.attributes).toContain('target="_blank"');
      expect(link.attributes).toContain('rel="noopener noreferrer"');
    }
  });

  it("underlines the links so they do not rely on colour", () => {
    for (const link of anchors(render("fr", true))) {
      expect(link.attributes).toMatch(/class="[^"]*\bunderline\b/);
    }
  });
});
