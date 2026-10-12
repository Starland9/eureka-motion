import { generateWithRetries } from "./generate";
import {
  LlmError,
  type GenerateRequest,
  type GenerateResult,
  type LlmHealth,
  type LlmProvider,
  type LlmRole,
  type RawCall,
  type RawCompletion,
} from "./types";

export interface RoleSettings {
  model: string;
  thinking: boolean;
}

export interface Endpoint {
  baseUrl: string;
  apiKey: string;
  sendThinking: boolean;
}

export interface OpenAiCompatibleConfig {
  name: string;
  endpoint: Endpoint;
  roles: Readonly<Record<LlmRole, RoleSettings>>;
  overrides?: Partial<Record<LlmRole, Endpoint>>;
  fetch?: typeof fetch;
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const HEALTH_TIMEOUT_MS = 4_000;

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  const send = config.fetch ?? fetch;
  const endpointFor = (role: LlmRole): Endpoint => config.overrides?.[role] ?? config.endpoint;

  async function call(raw: RawCall): Promise<RawCompletion> {
    const endpoint = endpointFor(raw.role);
    const settings = config.roles[raw.role];
    if (endpoint.apiKey === "") {
      throw new LlmError(
        "unavailable",
        raw.role,
        "No API key is configured for the language model.",
      );
    }
    const timeout = AbortSignal.timeout(raw.timeoutMs);
    const signal = raw.signal ? AbortSignal.any([raw.signal, timeout]) : timeout;
    const body: Record<string, unknown> = {
      model: settings.model,
      messages: [{ role: "system", content: raw.system }, ...raw.messages],
      response_format: { type: "json_object" },
      max_tokens: raw.maxTokens,
      stream: false,
    };
    if (endpoint.sendThinking) body.thinking = { type: settings.thinking ? "enabled" : "disabled" };

    let response: Response;
    try {
      response = await send(`${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (timeout.aborted) {
        throw new LlmError(
          "timeout",
          raw.role,
          `The ${raw.role} model did not answer within ${raw.timeoutMs} ms.`,
        );
      }
      if (raw.signal?.aborted)
        throw new LlmError("unavailable", raw.role, "The request was cancelled.");
      throw new LlmError("unavailable", raw.role, "The language model could not be reached.");
    }

    if (response.status === 429) {
      throw new LlmError("rate_limited", raw.role, "The language model is rate limiting requests.");
    }
    if (!response.ok) {
      throw new LlmError(
        "unavailable",
        raw.role,
        `The language model answered with status ${response.status}.`,
      );
    }

    let data: ChatResponse;
    try {
      data = (await response.json()) as ChatResponse;
    } catch {
      throw new LlmError("unavailable", raw.role, "The language model sent an unreadable answer.");
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      throw new LlmError("refused", raw.role, "The language model declined to answer.");
    }
    return {
      text: choice?.message?.content ?? "",
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      model: data.model ?? settings.model,
    };
  }

  return {
    name: config.name,
    modelFor: (role) => config.roles[role].model,
    generateObject: <T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> =>
      generateWithRetries(request, call),
    async health(): Promise<LlmHealth> {
      const started = Date.now();
      if (config.endpoint.apiKey === "") return { ok: false, latencyMs: 0 };
      try {
        const response = await send(`${config.endpoint.baseUrl.replace(/\/$/, "")}/models`, {
          headers: { authorization: `Bearer ${config.endpoint.apiKey}` },
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        return { ok: response.ok, latencyMs: Date.now() - started };
      } catch {
        return { ok: false, latencyMs: Date.now() - started };
      }
    },
  };
}
