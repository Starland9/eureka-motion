import path from "node:path";
import { createFixtureProvider, loadScenarios } from "./fixture";
import {
  createOpenAiCompatibleProvider,
  type Endpoint,
  type RoleSettings,
} from "./openai-compatible";
import { LLM_ROLES, type LlmProvider, type LlmRole } from "./types";

export * from "./types";
export { extractJson } from "./generate";
export { createFixtureProvider, loadScenarios, type Scenario, type ScenarioStep } from "./fixture";
export { createOpenAiCompatibleProvider } from "./openai-compatible";

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_MODELS: Readonly<Record<LlmRole, string>> = {
  triage: "deepseek-flash",
  author: "deepseek-flash",
  judge: "deepseek-v4-pro",
  checker: "deepseek-flash",
};

const DEFAULT_THINKING: Readonly<Record<LlmRole, boolean>> = {
  triage: false,
  author: false,
  judge: true,
  checker: false,
};

function roleSettings(env: Env): Record<LlmRole, RoleSettings> {
  const settings = {} as Record<LlmRole, RoleSettings>;
  for (const role of LLM_ROLES) {
    const suffix = role.toUpperCase();
    const thinking = env[`LLM_THINKING_${suffix}`];
    settings[role] = {
      model: env[`LLM_MODEL_${suffix}`] || DEFAULT_MODELS[role],
      thinking:
        thinking === undefined || thinking === "" ? DEFAULT_THINKING[role] : thinking === "on",
    };
  }
  return settings;
}

export function createProvider(env: Env = process.env): LlmProvider {
  const name = env.LLM_PROVIDER || "deepseek";
  if (name === "fixture") {
    const directory =
      env.LLM_FIXTURE_DIR || path.join(process.cwd(), "tests", "fixtures", "scenarios");
    return createFixtureProvider(loadScenarios(directory));
  }
  const endpoint: Endpoint = {
    baseUrl: env.LLM_BASE_URL || "https://api.deepseek.com",
    apiKey: env.LLM_API_KEY ?? "",
    sendThinking: name === "deepseek",
  };
  const judgeProvider = env.LLM_JUDGE_PROVIDER;
  const overrides: Partial<Record<LlmRole, Endpoint>> = judgeProvider
    ? {
        judge: {
          baseUrl: env.LLM_JUDGE_BASE_URL || endpoint.baseUrl,
          apiKey: env.LLM_JUDGE_API_KEY ?? "",
          sendThinking: judgeProvider === "deepseek",
        },
      }
    : {};
  return createOpenAiCompatibleProvider({ name, endpoint, roles: roleSettings(env), overrides });
}

let cached: LlmProvider | undefined;

export function getLlm(): LlmProvider {
  cached ??= createProvider();
  return cached;
}

export function resetLlm(): void {
  cached = undefined;
}
