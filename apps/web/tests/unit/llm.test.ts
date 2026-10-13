import { describe, expect, it, vi, type Mock } from "vitest";
import { z } from "zod";
import {
  createFixtureProvider,
  createOpenAiCompatibleProvider,
  createProvider,
  extractJson,
  LlmError,
  type LlmRole,
  type Scenario,
} from "@/server/llm";

const SECRET = "sk-test-secret-key";
const Answer = z.strictObject({ answer: z.number() });

const roles: Record<LlmRole, { model: string; thinking: boolean }> = {
  triage: { model: "fast", thinking: false },
  author: { model: "fast", thinking: false },
  judge: { model: "strong", thinking: true },
  checker: { model: "fast", thinking: false },
};

function reply(content: string, status = 200, finish = "stop"): Response {
  return new Response(
    JSON.stringify({
      model: "served-model",
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function providerWith(fetchMock: FetchMock, sendThinking = true) {
  return createOpenAiCompatibleProvider({
    name: "deepseek",
    endpoint: { baseUrl: "https://llm.test/", apiKey: SECRET, sendThinking },
    roles,
    fetch: fetchMock,
  });
}

const request = (role: LlmRole = "author") => ({
  role,
  system: "You write numbers.",
  messages: [{ role: "user" as const, content: "Give me the answer." }],
  schema: Answer,
});

type FetchMock = Mock<typeof fetch>;

const mockFetch = (implementation?: typeof fetch): FetchMock => vi.fn<typeof fetch>(implementation);

const bodyOf = (mock: FetchMock, call = 0): Record<string, unknown> =>
  JSON.parse(mock.mock.calls[call]![1]!.body as string);

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return error as LlmError;
  }
  throw new Error("expected the call to fail");
}

describe("extractJson", () => {
  it("reads a bare object, a fenced object and an object surrounded by prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here it is: {"a":1} Hope it helps.')).toEqual({ a: 1 });
  });

  it("forgives a comma left before a closing brace or bracket", () => {
    expect(extractJson('{"a":[1,2,],"b":{"c":"x, y",},}')).toEqual({ a: [1, 2], b: { c: "x, y" } });
  });

  it("rejects an empty reply, a reply without an object and broken JSON", () => {
    expect(() => extractJson("   ")).toThrow("empty");
    expect(() => extractJson("no object here")).toThrow("no JSON object");
    expect(() => extractJson('{"a": }')).toThrow("not valid JSON");
  });
});

describe("OpenAI-compatible provider", () => {
  it("returns the validated object with usage and the served model", async () => {
    const fetchMock = mockFetch(async () => reply('{"answer": 42}'));
    const result = await providerWith(fetchMock).generateObject(request());
    expect(result.value).toEqual({ answer: 42 });
    expect(result.attempts).toBe(1);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.model).toBe("served-model");
  });

  it("asks for JSON mode, sets a token limit and mentions json in the system prompt", async () => {
    const fetchMock = mockFetch(async () => reply('{"answer": 1}'));
    await providerWith(fetchMock).generateObject(request());
    expect(fetchMock.mock.calls[0]![0]).toBe("https://llm.test/chat/completions");
    const body = bodyOf(fetchMock);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.stream).toBe(false);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content.toLowerCase()).toContain("json");
    expect(messages[1]).toEqual({ role: "user", content: "Give me the answer." });
  });

  it("sets the model and the thinking switch per role", async () => {
    const fetchMock = mockFetch(async () => reply('{"answer": 1}'));
    const provider = providerWith(fetchMock);
    await provider.generateObject(request("author"));
    await provider.generateObject(request("judge"));
    expect(bodyOf(fetchMock, 0)).toMatchObject({ model: "fast", thinking: { type: "disabled" } });
    expect(bodyOf(fetchMock, 1)).toMatchObject({ model: "strong", thinking: { type: "enabled" } });
    expect(provider.modelFor("judge")).toBe("strong");
  });

  it("omits the thinking switch for providers that do not know it", async () => {
    const fetchMock = mockFetch(async () => reply('{"answer": 1}'));
    await providerWith(fetchMock, false).generateObject(request());
    expect(bodyOf(fetchMock)).not.toHaveProperty("thinking");
  });

  it("asks again with the validation message when the output is invalid, then succeeds", async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(reply('{"answer": "forty-two"}'))
      .mockResolvedValueOnce(reply('{"answer": 42}'));
    const result = await providerWith(fetchMock).generateObject(request());
    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    const messages = bodyOf(fetchMock, 1).messages as { role: string; content: string }[];
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ role: "assistant", content: '{"answer": "forty-two"}' });
    expect(messages[3]!.content).toContain("rejected");
    expect(messages[3]!.content).toContain("answer");
  });

  it("treats an empty reply as invalid output", async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(reply(""))
      .mockResolvedValueOnce(reply('{"answer": 7}'));
    const result = await providerWith(fetchMock).generateObject(request());
    expect(result.attempts).toBe(2);
    const messages = bodyOf(fetchMock, 1).messages as { role: string; content: string }[];
    expect(messages[2]!.content).toBe("(empty reply)");
    expect(messages[3]!.content).toContain("empty");
  });

  it("runs the caller's own validation and feeds its message back", async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(reply('{"answer": -1}'))
      .mockResolvedValueOnce(reply('{"answer": 3}'));
    const result = await providerWith(fetchMock).generateObject({
      ...request(),
      validate: (value) =>
        value.answer < 0 ? "Rule 5 (framing) failed: answer is negative" : null,
    });
    expect(result.value.answer).toBe(3);
    const messages = bodyOf(fetchMock, 1).messages as { role: string; content: string }[];
    expect(messages[3]!.content).toContain("Rule 5 (framing) failed");
  });

  it("gives up with invalid_output after two retries", async () => {
    const fetchMock = mockFetch(async () => reply("not json"));
    const error = await failure(providerWith(fetchMock).generateObject(request()));
    expect(error.code).toBe("invalid_output");
    expect(error.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps a slow answer to timeout", async () => {
    const fetchMock = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const error = await failure(
      providerWith(fetchMock).generateObject({ ...request(), timeoutMs: 20 }),
    );
    expect(error.code).toBe("timeout");
  });

  it("maps HTTP 429 to rate_limited and other failures to unavailable", async () => {
    expect(
      (await failure(providerWith(mockFetch(async () => reply("", 429))).generateObject(request())))
        .code,
    ).toBe("rate_limited");
    expect(
      (await failure(providerWith(mockFetch(async () => reply("", 500))).generateObject(request())))
        .code,
    ).toBe("unavailable");
    const network = mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await failure(providerWith(network).generateObject(request()))).code).toBe(
      "unavailable",
    );
  });

  it("maps a filtered answer to refused", async () => {
    const fetchMock = mockFetch(async () => reply("", 200, "content_filter"));
    expect((await failure(providerWith(fetchMock).generateObject(request()))).code).toBe("refused");
  });

  it("is unavailable without an API key, and never calls the network", async () => {
    const fetchMock = mockFetch();
    const provider = createOpenAiCompatibleProvider({
      name: "deepseek",
      endpoint: { baseUrl: "https://llm.test", apiKey: "", sendThinking: true },
      roles,
      fetch: fetchMock,
    });
    expect((await failure(provider.generateObject(request()))).code).toBe("unavailable");
    expect(await provider.health()).toEqual({ ok: false, latencyMs: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never leaks the API key in an error", async () => {
    for (const fetchMock of [
      mockFetch(async () => reply("", 500)),
      mockFetch(async () => reply("", 429)),
      mockFetch(async () => reply("not json")),
      mockFetch(async () => {
        throw new TypeError(`fetch failed for key ${SECRET}`);
      }),
    ]) {
      const error = await failure(providerWith(fetchMock).generateObject(request()));
      expect(error.message).not.toContain(SECRET);
      expect(String(error.stack)).not.toContain(SECRET);
    }
  });

  it("sends a role to another endpoint when one is configured for it", async () => {
    const fetchMock = mockFetch(async () => reply('{"answer": 1}'));
    const provider = createOpenAiCompatibleProvider({
      name: "deepseek",
      endpoint: { baseUrl: "https://llm.test", apiKey: SECRET, sendThinking: true },
      overrides: { judge: { baseUrl: "https://judge.test", apiKey: "other", sendThinking: false } },
      roles,
      fetch: fetchMock,
    });
    await provider.generateObject(request("judge"));
    expect(fetchMock.mock.calls[0]![0]).toBe("https://judge.test/chat/completions");
    expect(bodyOf(fetchMock)).not.toHaveProperty("thinking");
  });

  it("reports health from the models endpoint", async () => {
    expect(
      (await providerWith(mockFetch(async () => new Response("{}", { status: 200 }))).health()).ok,
    ).toBe(true);
    expect(
      (await providerWith(mockFetch(async () => new Response("{}", { status: 401 }))).health()).ok,
    ).toBe(false);
  });
});

describe("fixture provider", () => {
  const scenario: Scenario = {
    name: "gravity",
    question: "la loi de la gravité",
    steps: [
      { role: "triage", response: { answer: 1 } },
      { role: "author", when: "SCENE 2", response: { answer: 22 } },
      { role: "author", when: "SCENE 1", text: "oops" },
      { role: "author", when: "SCENE 1", response: { answer: 11 } },
      { role: "checker", response: { answer: 5 }, repeat: true },
      { role: "judge", error: "timeout" },
    ],
  };
  const ask = (role: LlmRole, content: string, traceId = "t1") => ({
    role,
    system: "x",
    messages: [{ role: "user" as const, content }],
    schema: Answer,
    traceId,
  });

  it("replays the steps of the scenario that matches the question", async () => {
    const provider = createFixtureProvider([scenario]);
    expect(
      (await provider.generateObject(ask("triage", "Je n'ai pas compris la loi de la gravité")))
        .value.answer,
    ).toBe(1);
    expect((await provider.generateObject(ask("author", "write SCENE 2"))).value.answer).toBe(22);
    expect(provider.modelFor("author")).toBe("fixture");
  });

  it("goes through the same retry loop as a real provider", async () => {
    const provider = createFixtureProvider([scenario]);
    await provider.generateObject(ask("triage", "la loi de la gravité"));
    const result = await provider.generateObject(ask("author", "write SCENE 1"));
    expect(result.value.answer).toBe(11);
    expect(result.attempts).toBe(2);
  });

  it("reuses a step marked as repeatable", async () => {
    const provider = createFixtureProvider([scenario]);
    await provider.generateObject(ask("triage", "la loi de la gravité"));
    expect((await provider.generateObject(ask("checker", "a"))).value.answer).toBe(5);
    expect((await provider.generateObject(ask("checker", "b"))).value.answer).toBe(5);
  });

  it("raises the error a step declares", async () => {
    const provider = createFixtureProvider([scenario]);
    await provider.generateObject(ask("triage", "la loi de la gravité"));
    expect((await failure(provider.generateObject(ask("judge", "check")))).code).toBe("timeout");
  });

  it("is unavailable when the scenario is exhausted or when no scenario matches", async () => {
    const provider = createFixtureProvider([scenario]);
    await provider.generateObject(ask("triage", "la loi de la gravité"));
    expect((await failure(provider.generateObject(ask("triage", "again")))).code).toBe(
      "unavailable",
    );
    expect(
      (await failure(provider.generateObject(ask("triage", "la photosynthèse", "t2")))).code,
    ).toBe("unavailable");
    expect((await createFixtureProvider([]).health()).ok).toBe(false);
  });

  it("keeps separate progress per trace", async () => {
    const provider = createFixtureProvider([scenario]);
    expect(
      (await provider.generateObject(ask("triage", "la loi de la gravité", "a"))).value.answer,
    ).toBe(1);
    expect(
      (await provider.generateObject(ask("triage", "la loi de la gravité", "b"))).value.answer,
    ).toBe(1);
  });
});

describe("provider factory", () => {
  it("defaults to DeepSeek with the models and thinking of the plan", () => {
    const provider = createProvider({ LLM_API_KEY: SECRET });
    expect(provider.name).toBe("deepseek");
    expect(provider.modelFor("triage")).toBe("deepseek-flash");
    expect(provider.modelFor("author")).toBe("deepseek-flash");
    expect(provider.modelFor("checker")).toBe("deepseek-flash");
    expect(provider.modelFor("judge")).toBe("deepseek-v4-pro");
  });

  it("changes model by configuration only", () => {
    const provider = createProvider({
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "https://other.test/v1",
      LLM_API_KEY: SECRET,
      LLM_MODEL_AUTHOR: "other-model",
    });
    expect(provider.name).toBe("openai-compatible");
    expect(provider.modelFor("author")).toBe("other-model");
  });

  it("builds the fixture provider from a directory of scenarios", async () => {
    const provider = createProvider({ LLM_PROVIDER: "fixture", LLM_FIXTURE_DIR: "/nonexistent" });
    expect(provider.name).toBe("fixture");
    expect((await provider.health()).ok).toBe(false);
  });
});
