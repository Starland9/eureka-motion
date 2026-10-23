import type { Language } from "scene";
import { describe, expect, it, vi } from "vitest";
import {
  errorMessage,
  errorResponse,
  internalError,
  requestLanguage,
  type ErrorCode,
} from "../../src/server/http/errors";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  mode_not_supported: 400,
  parent_not_found: 404,
  not_found: 404,
  expired: 410,
  not_ready: 409,
  rate_limited: 429,
  generation_unavailable: 503,
  internal_error: 500,
};
const CODES = Object.keys(STATUS) as ErrorCode[];
const LANGUAGES: Language[] = ["fr", "en"];
const MATRIX = CODES.flatMap((code) => LANGUAGES.map((language) => [code, language] as const));

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/explanations", { headers });
}

describe("API error messages", () => {
  it.each(MATRIX)("%s has a message in %s", (code, language) => {
    const message = errorMessage(language, code);
    expect(typeof message).toBe("string");
    expect(message.trim().length).toBeGreaterThan(10);
    expect(message).toMatch(/[.!]$/);
  });

  it.each(CODES)("%s is written differently in French and in English", (code) => {
    expect(errorMessage("fr", code)).not.toBe(errorMessage("en", code));
  });

  it.each(LANGUAGES)("gives each code its own message in %s", (language) => {
    const messages = CODES.map((code) => errorMessage(language, code));
    expect(new Set(messages).size).toBe(CODES.length);
  });

  it.each(CODES)("%s: each message is written in its own language", (code) => {
    const accents = /[àâçéèêëîïôùûüœ]/i;
    const english = /\b(?:the|your|you|this|is|could|try|again|not)\b/i;
    const french = /\b(?:le|la|les|des|une?|ce|cette|tu|ta|ton|est)\b/i;
    expect(errorMessage("en", code)).toMatch(english);
    expect(errorMessage("en", code)).not.toMatch(accents);
    expect(errorMessage("fr", code)).toMatch(french);
    expect(errorMessage("fr", code)).not.toMatch(english);
  });

  it.each(CODES)("%s follows the French typography", (code) => {
    const message = errorMessage("fr", code);
    expect(message).not.toMatch(/ [:;!?]/);
    expect(message).not.toContain("'");
  });

  it.each(MATRIX)("%s in %s leaks nothing technical", (code, language) => {
    expect(errorMessage(language, code)).not.toMatch(
      /exception|stack|undefined|null|sql|zod|json|http|\d{3}/i,
    );
  });
});

describe("errorResponse", () => {
  it.each(MATRIX)("%s in %s answers the documented status and body", async (code, language) => {
    const response = errorResponse(code, language);
    expect(response.status).toBe(STATUS[code]);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code, message: errorMessage(language, code) },
    });
  });

  it("adds headers and extra fields without touching the message", async () => {
    const response = errorResponse("rate_limited", "en", {
      headers: { "Retry-After": "30" },
      extra: { references: [] },
    });
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({
      error: { code: "rate_limited", message: errorMessage("en", "rate_limited") },
      references: [],
    });
  });

  it.each(LANGUAGES)(
    "answers an unexpected failure in %s without its details",
    async (language) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const response = internalError(new Error("password=hunter2"), language);
      const text = await response.text();
      error.mockRestore();
      expect(response.status).toBe(500);
      expect(text).not.toContain("hunter2");
      expect(JSON.parse(text).error.message).toBe(errorMessage(language, "internal_error"));
    },
  );
});

describe("requestLanguage", () => {
  it.each<[string, Record<string, string>, unknown, Language]>([
    ["the language of the body", { "accept-language": "fr" }, { language: "en" }, "en"],
    ["the language of the body", { "accept-language": "en" }, { language: "fr" }, "fr"],
    ["Accept-Language without a body", { "accept-language": "en" }, undefined, "en"],
    ["Accept-Language when the body has no language", { "accept-language": "en" }, {}, "en"],
    [
      "Accept-Language when the body language is null",
      { "accept-language": "en" },
      { language: null },
      "en",
    ],
    [
      "Accept-Language when the body language is unknown",
      { "accept-language": "en" },
      { language: "de" },
      "en",
    ],
    ["Accept-Language when the body is not an object", { "accept-language": "en" }, "fr", "en"],
    ["Accept-Language when the body is null", { "accept-language": "en" }, null, "en"],
    ["the region subtag ignored", { "accept-language": "en-GB" }, undefined, "en"],
    ["the tag case ignored", { "accept-language": "EN-us" }, undefined, "en"],
    [
      "the heaviest supported entry",
      { "accept-language": "fr;q=0.5, en;q=0.8, de" },
      undefined,
      "en",
    ],
    ["the first of equal weights", { "accept-language": "en, fr" }, undefined, "en"],
    ["the first supported entry", { "accept-language": "de, es, en;q=0.1" }, undefined, "en"],
    ["a refused language skipped", { "accept-language": "en;q=0, fr;q=0.1" }, undefined, "fr"],
    ["French without any header", {}, undefined, "fr"],
    ["French for an unsupported language", { "accept-language": "de-DE, es" }, undefined, "fr"],
    ["French for a wildcard", { "accept-language": "*" }, undefined, "fr"],
    ["French for an empty header", { "accept-language": "" }, undefined, "fr"],
  ])("takes %s", (_name, headers, body, expected) => {
    expect(requestLanguage(request(headers), body)).toBe(expected);
  });
});
