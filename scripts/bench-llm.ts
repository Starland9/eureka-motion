const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const apiKey = process.env.LLM_API_KEY ?? "";

interface Case {
  label: string;
  model: string;
  thinking: boolean;
  words: number;
}

interface Measure {
  label: string;
  model: string;
  thinking: boolean;
  firstTokenMs: number;
  totalMs: number;
  outputTokens: number;
  tokensPerSecond: number;
  status: string;
}

const flash = process.env.LLM_MODEL_AUTHOR ?? "deepseek-flash";
const pro = process.env.LLM_MODEL_JUDGE ?? "deepseek-v4-pro";

const cases: Case[] = [
  { label: "triage-size (about 150 tokens)", model: flash, thinking: false, words: 90 },
  { label: "outline-size (about 600 tokens)", model: flash, thinking: false, words: 380 },
  { label: "scene-size (about 700 tokens)", model: flash, thinking: false, words: 450 },
  { label: "judge-size (about 150 tokens)", model: pro, thinking: true, words: 90 },
  { label: "judge-size, flash with thinking", model: flash, thinking: true, words: 90 },
];

async function run(test: Case): Promise<Measure> {
  const started = performance.now();
  let firstTokenMs = 0;
  let outputTokens = 0;
  let status = "ok";
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: test.model,
        messages: [
          {
            role: "system",
            content: "You are a physics teacher. Reply with a single JSON object.",
          },
          {
            role: "user",
            content: `Explain Newton's law of gravitation in about ${test.words} words, as JSON: { "explanation": "…" }. Is the statement "the force is divided by four when the distance doubles" correct? Add "correct": true or false.`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 4000,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: test.thinking ? "enabled" : "disabled" },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok || !response.body) {
      status = `http ${response.status}`;
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          const chunk = JSON.parse(line.slice(6)) as {
            choices?: { delta?: { content?: string | null } }[];
            usage?: { completion_tokens?: number };
          };
          if (firstTokenMs === 0 && chunk.choices?.[0]?.delta?.content) {
            firstTokenMs = performance.now() - started;
          }
          if (chunk.usage?.completion_tokens) outputTokens = chunk.usage.completion_tokens;
        }
      }
    }
  } catch (error) {
    status = (error as Error).name;
  }
  const totalMs = performance.now() - started;
  const generationMs = Math.max(1, totalMs - firstTokenMs);
  return {
    label: test.label,
    model: test.model,
    thinking: test.thinking,
    firstTokenMs: Math.round(firstTokenMs),
    totalMs: Math.round(totalMs),
    outputTokens,
    tokensPerSecond: Math.round((outputTokens / generationMs) * 1000),
    status,
  };
}

async function main(): Promise<void> {
  if (apiKey === "") {
    console.error("LLM_API_KEY is not set");
    process.exit(1);
  }
  const rounds = Number(process.argv[2] ?? 2);
  const results: Measure[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const test of cases) results.push(await run(test));
  }
  console.table(
    results.map(
      ({
        label,
        model,
        thinking,
        firstTokenMs,
        totalMs,
        outputTokens,
        tokensPerSecond,
        status,
      }) => ({
        case: label,
        model,
        thinking,
        "first token (ms)": firstTokenMs,
        "total (ms)": totalMs,
        "output tokens": outputTokens,
        "tokens/s": tokensPerSecond,
        status,
      }),
    ),
  );
}

void main();
