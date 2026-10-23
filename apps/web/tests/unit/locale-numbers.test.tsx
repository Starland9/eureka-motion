import { createTranslator, NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentSchema } from "scene";
import type { Language } from "scene";
import { describe, expect, it, vi } from "vitest";
import { MakingSection } from "@/components/colophon/MakingSection";
import { Params } from "@/components/controls/Params";
import {
  deriveResults,
  editText,
  formatResult,
  formatValue,
  parseEntry,
} from "@/components/controls/params-values";
import { formatDuration, formatFigureNumber } from "@/components/player/scene-list-entries";
import { formatClock } from "@/components/player/transport-time";
import { messages } from "@/i18n/messages";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

const NNBSP = String.fromCharCode(0x202f);
const NBSP = String.fromCharCode(0xa0);
const LANGUAGES: Language[] = ["fr", "en"];
const document = DocumentSchema.parse(reference.payload);

function markup(locale: Language, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replaceAll(NBSP, " ")
    .replaceAll("&#x27;", "'");

const translator = (locale: Language) => createTranslator({ locale, messages: messages[locale] });

describe("parameters panel", () => {
  const values = { m2: 7.32e22 };
  const panel = (locale: Language): string =>
    textOf(
      markup(
        locale,
        <Params
          params={document.params}
          values={values}
          results={deriveResults(document.params, document.model, values)}
          onChange={vi.fn()}
          onReset={vi.fn()}
        />,
      ),
    );

  it("writes the force 1,98 in French and 1.98 in English", () => {
    expect(panel("fr")).toContain("1,98 × 10²⁰ N");
    expect(panel("en")).toContain("1.98 × 10²⁰ N");
    expect(panel("fr")).not.toContain("1.98");
    expect(panel("en")).not.toContain("1,98");
  });

  it("groups the thousands of a result with a narrow no-break space in French only", () => {
    const [result] = deriveResults(document.params, document.model, {}).filter(
      (item) => item.id === "r_km",
    );
    expect(formatResult(result!, "fr")).toBe(`384${NNBSP}000`);
    expect(formatResult(result!, "en")).toBe("384,000");
  });

  it("writes the values of the fields and reads them back in the same language", () => {
    expect(formatValue(1234.5, "fr")).toBe(`1${NNBSP}234,5`);
    expect(formatValue(1234.5, "en")).toBe("1,234.5");
    expect(editText(1234.5, "fr")).toBe("1234,5");
    expect(editText(1234.5, "en")).toBe("1234.5");
    for (const language of LANGUAGES) {
      expect(parseEntry(editText(1234.5, language), language)).toBe(1234.5);
      expect(parseEntry(formatValue(1234.5, language), language)).toBe(1234.5);
    }
  });
});

describe("colophon timings", () => {
  const timings = { first_scene: 1500, total: 1_234_500 };
  const making = (locale: Language): string =>
    textOf(markup(locale, <MakingSection generator={null} timings={timings} />));

  it("uses the decimal comma and the grouping of the language", () => {
    expect(making("fr")).toContain("1,5 s");
    expect(making("fr")).toContain(`1${NNBSP}234,5 s`);
    expect(making("en")).toContain("1.5 s");
    expect(making("en")).toContain("1,234.5 s");
  });
});

describe("player timer and scene list", () => {
  it("writes minutes and seconds the same way in both languages", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatFigureNumber(5)).toBe("05");
    for (const locale of LANGUAGES) {
      const t = translator(locale);
      expect(t("Transport.time", { elapsed: formatClock(12), total: formatClock(65) })).toBe(
        "0:12 / 1:05",
      );
      expect(t("Transport.timePartial", { elapsed: formatClock(12), total: formatClock(65) })).toBe(
        "0:12 / 1:05+",
      );
    }
  });

  it("puts a no-break space before the percent sign of the volume in French only", () => {
    expect(translator("fr")("Transport.volumeValue", { value: 50 })).toBe(`50${NBSP}%`);
    expect(translator("en")("Transport.volumeValue", { value: 50 })).toBe("50%");
  });

  it("counts scenes with the grouping of the language", () => {
    expect(translator("fr")("Scenes.complete", { count: 1234 })).toBe(`1${NNBSP}234 scènes`);
    expect(translator("en")("Scenes.complete", { count: 1234 })).toBe("1,234 scenes");
    expect(translator("fr")("Scenes.complete", { count: 1 })).toBe("1 scène");
    expect(translator("en")("Scenes.complete", { count: 0 })).toBe("No scene");
  });
});
