import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FILE = path.join(__dirname, "..", "..", "..", "..", "scripts", "voice-phrases.json");
const PHRASES = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string[]>;

describe.each(["fr", "en"])("scripts/voice-phrases.json (%s)", (lang) => {
  const phrases = PHRASES[lang] ?? [];

  it("has at least 10 phrases", () => {
    expect(phrases.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps every phrase between 1 and 200 characters", () => {
    for (const phrase of phrases) {
      expect(typeof phrase).toBe("string");
      expect(phrase.length).toBeGreaterThanOrEqual(1);
      expect(phrase.length).toBeLessThanOrEqual(200);
    }
  });

  it("has at least 3 phrases with a digit", () => {
    expect(phrases.filter((phrase) => /\d/.test(phrase)).length).toBeGreaterThanOrEqual(3);
  });

  it("has at least 2 phrases with a squared formula", () => {
    expect(phrases.filter((phrase) => phrase.includes("²")).length).toBeGreaterThanOrEqual(2);
  });

  it("has no duplicate phrase", () => {
    expect(new Set(phrases).size).toBe(phrases.length);
  });
});
