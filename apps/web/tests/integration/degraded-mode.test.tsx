import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTranslator, NextIntlClientProvider, useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { POST } from "../../src/app/api/explanations/route";
import {
  describeRejection,
  RejectionAlert,
  type AskTranslate,
} from "../../src/components/ask/Rejection";
import { createExplanationClient } from "../../src/components/explanation/stream";
import type { StartOutcome } from "../../src/components/explanation/types";
import { messages } from "../../src/i18n/messages";
import { setContainerForTests, type Container } from "../../src/server/container";
import { closeDb } from "../../src/server/db/client";
import { resetVoiceAvailability } from "../../src/server/health/voice";
import { resetGenerationAvailability } from "../../src/server/http/availability";
import { errorMessage } from "../../src/server/http/errors";
import { resetLlm } from "../../src/server/llm";
import { referenceId } from "../../src/server/reference";
import { resetVoice } from "../../src/server/tts";

// next-intl's navigation module imports "next/navigation" without an extension, which plain
// Node ESM cannot resolve; the stand-in keeps the locale prefix the real Link adds.
vi.mock("@/i18n/navigation", () => ({
  Link: function Link({ href, ...props }: ComponentProps<"a"> & { href: string }) {
    return <a href={`/${useLocale()}${href}`} {...props} />;
  },
}));

const UNREACHABLE = "postgresql://eureka:eureka@127.0.0.1:1/eureka";
const BODY = { question: "pourquoi le ciel est bleu", language: "fr", level: "lycee" } as const;
const FRENCH_ID = referenceId(reference.slug, "fr");
const ENGLISH_TITLE = "Universal gravitation";
const ENGLISH_ID = referenceId(reference.slug, "en");

let root: string;
let scenarioDir: string;
let referenceDir: string;

function post(body: unknown = BODY): Request {
  return new Request("http://localhost/api/explanations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resetProbes(): void {
  resetLlm();
  resetVoice();
  resetGenerationAvailability();
  resetVoiceAvailability();
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(html: string): string {
  return normalize(html.replace(/<[^>]*>/g, ""));
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "degraded-mode-"));
  scenarioDir = path.join(root, "scenarios");
  referenceDir = path.join(root, "reference");
  await mkdir(scenarioDir);
  await mkdir(referenceDir);
  await writeFile(
    path.join(referenceDir, "physics.universal-gravitation.fr.json"),
    JSON.stringify(reference),
  );
  await writeFile(
    path.join(referenceDir, "physics.universal-gravitation.en.json"),
    JSON.stringify({ ...structuredClone(reference), language: "en", title: ENGLISH_TITLE }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", UNREACHABLE);
  vi.stubEnv("MEDIA_DIR", path.join(root, "media"));
  vi.stubEnv("LLM_PROVIDER", "fixture");
  vi.stubEnv("LLM_FIXTURE_DIR", scenarioDir);
  vi.stubEnv("TTS_PROVIDERS", "none");
  vi.stubEnv("REFERENCE_DIR", referenceDir);
  setContainerForTests(undefined);
  resetProbes();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setContainerForTests(undefined);
  resetProbes();
  await rm(path.join(scenarioDir, "recorded.json"), { force: true });
  await closeDb();
});

describe("POST /api/explanations: simulated provider without scenario, database stopped", () => {
  it("answers 503 generation_unavailable with the references of the language", async () => {
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "generation_unavailable",
        message: errorMessage("fr", "generation_unavailable"),
      },
      references: [
        {
          slug: reference.slug,
          subject: reference.subject,
          title: reference.title,
          reference_level: reference.reference_level,
          explanation_id: FRENCH_ID,
        },
      ],
    });
  });

  it("answers in English with the English references when the body asks for English", async () => {
    const response = await POST(post({ ...BODY, language: "en" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "generation_unavailable",
        message: errorMessage("en", "generation_unavailable"),
      },
      references: [
        {
          slug: reference.slug,
          subject: reference.subject,
          title: ENGLISH_TITLE,
          reference_level: reference.reference_level,
          explanation_id: ENGLISH_ID,
        },
      ],
    });
  });

  it("leaks nothing about the database", async () => {
    const text = await (await POST(post())).text();
    for (const leak of ["postgres", "127.0.0.1", "ECONNREFUSED", "eureka:eureka"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("still answers 503, with an empty list, when the references cannot be read", async () => {
    vi.stubEnv("REFERENCE_DIR", path.join(root, "missing"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(post());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string }; references: unknown[] };
    expect(body.error.code).toBe("generation_unavailable");
    expect(body.references).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("ENOENT");
  });

  it("answers 503 without waiting for a database that never answers, and takes no rate limit hit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const limiter = vi.fn();
    setContainerForTests({
      cache: { findByQuestion: () => new Promise<string | null>(() => undefined) },
      limiter: { check: limiter },
    } as unknown as Container);
    const pending = POST(post());
    await vi.advanceTimersByTimeAsync(3_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(limiter).not.toHaveBeenCalled();
  });
});

describe("POST /api/explanations: database stopped, generation available", () => {
  it("still answers 500 internal_error: the lookup failure is not hidden", async () => {
    await writeFile(
      path.join(scenarioDir, "recorded.json"),
      JSON.stringify({ name: "recorded", question: "gravité", steps: [] }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(post());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: errorMessage("fr", "internal_error") },
    });
  });
});

describe("the home page after a free question while generation is unavailable", () => {
  const T = { fr: messages.fr.Ask, en: messages.en.Ask } as const;

  async function ask(language: "fr" | "en"): Promise<Extract<StartOutcome, { kind: "rejected" }>> {
    const client = createExplanationClient({
      fetch: (input, init) => POST(new Request(`http://localhost${String(input)}`, init)),
    });
    const outcome = await client.start({
      question: BODY.question,
      language,
      level: "lycee",
    });
    if (outcome.kind !== "rejected") throw new Error("the question should be rejected");
    return outcome;
  }

  function home(language: "fr" | "en", outcome: Extract<StartOutcome, { kind: "rejected" }>) {
    const t = createTranslator({
      locale: language,
      messages: messages[language],
      namespace: "Ask",
    }) as unknown as AskTranslate;
    const rejection = describeRejection(t, outcome);
    return renderToStaticMarkup(
      <NextIntlClientProvider locale={language} messages={messages[language]}>
        <RejectionAlert id="alert" rejection={rejection} />
      </NextIntlClientProvider>,
    );
  }

  it.each(["fr", "en"] as const)(
    "carries the code and the references of the route to the client in %s",
    async (language) => {
      const outcome = await ask(language);
      expect(outcome.code).toBe("generation_unavailable");
      expect(outcome.references).toHaveLength(1);
      expect(outcome.references?.[0]?.explanation_id).toBe(
        language === "fr" ? FRENCH_ID : ENGLISH_ID,
      );
    },
  );

  it.each(["fr", "en"] as const)(
    "shows the translated message in the alert in %s",
    async (language) => {
      const html = home(language, await ask(language));
      const text = textOf(html);
      expect(html).toMatch(/<div id="alert" role="alert"><p\b/);
      expect(text).toContain(normalize(T[language].errors.generationUnavailable));
    },
  );

  it("shows the translated message when the route lists no reference", () => {
    const html = home("fr", {
      kind: "rejected",
      code: "generation_unavailable",
      message: "",
      references: [],
    });
    expect(textOf(html)).toContain(normalize(T.fr.errors.generationUnavailable));
  });

  it("shows the translated message even when the old server sends no list", () => {
    const html = home("fr", { kind: "rejected", code: "generation_unavailable", message: "x" });
    expect(textOf(html)).toContain(normalize(T.fr.errors.generationUnavailable));
  });

  it("keeps the message of the server for another rejection", () => {
    const html = home("fr", {
      kind: "rejected",
      code: "rate_limited",
      message: "x",
      retryAfterSeconds: 20,
      references: [
        {
          slug: reference.slug,
          subject: "physics",
          title: reference.title,
          reference_level: "lycee",
          explanation_id: FRENCH_ID,
        },
      ],
    });
    expect(textOf(html)).toContain("20 secondes");
  });

  it("shows no message before any question", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="fr" messages={messages.fr}>
        <RejectionAlert id="alert" rejection={null} />
      </NextIntlClientProvider>,
    );
    expect(html).toBe('<div id="alert" role="alert"></div>');
  });
});
