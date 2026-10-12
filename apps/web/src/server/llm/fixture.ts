import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateWithRetries } from "./generate";
import {
  LlmError,
  type GenerateRequest,
  type GenerateResult,
  type LlmErrorCode,
  type LlmProvider,
  type LlmRole,
  type RawCall,
  type RawCompletion,
} from "./types";

export interface ScenarioStep {
  role: LlmRole;
  when?: string;
  response?: unknown;
  text?: string;
  error?: LlmErrorCode;
  repeat?: boolean;
  delayMs?: number;
}

export interface Scenario {
  name: string;
  question: string;
  steps: ScenarioStep[];
}

export function loadScenarios(directory: string): Scenario[] {
  let files: string[];
  try {
    files = readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  return files.map(
    (file) => JSON.parse(readFileSync(path.join(directory, file), "utf8")) as Scenario,
  );
}

interface Session {
  scenario: Scenario;
  used: Set<number>;
}

const FIXTURE_MODEL = "fixture";
const DEFAULT_TRACE = "default";

export function createFixtureProvider(scenarios: readonly Scenario[]): LlmProvider {
  const sessions = new Map<string, Session>();

  function sessionFor(raw: RawCall, transcript: string): Session {
    const key = raw.traceId ?? DEFAULT_TRACE;
    const existing = sessions.get(key);
    if (existing) return existing;
    const lowered = transcript.toLowerCase();
    const scenario = scenarios.find((candidate) =>
      lowered.includes(candidate.question.toLowerCase()),
    );
    if (!scenario) {
      throw new LlmError("unavailable", raw.role, "No recorded scenario matches this question.");
    }
    const session: Session = { scenario, used: new Set() };
    sessions.set(key, session);
    return session;
  }

  async function call(raw: RawCall): Promise<RawCompletion> {
    const transcript = raw.messages.map((message) => message.content).join("\n");
    const session = sessionFor(raw, transcript);
    const index = session.scenario.steps.findIndex(
      (step, i) =>
        step.role === raw.role &&
        (!session.used.has(i) || step.repeat === true) &&
        (step.when === undefined || transcript.includes(step.when)),
    );
    const step = session.scenario.steps[index];
    if (!step) {
      throw new LlmError(
        "unavailable",
        raw.role,
        `Scenario "${session.scenario.name}" has no more ${raw.role} step.`,
      );
    }
    session.used.add(index);
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    if (step.error)
      throw new LlmError(step.error, raw.role, `Scenario step failed with ${step.error}.`);
    return {
      text: step.text ?? JSON.stringify(step.response),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: FIXTURE_MODEL,
    };
  }

  return {
    name: "fixture",
    modelFor: () => FIXTURE_MODEL,
    generateObject: <T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> =>
      generateWithRetries(request, call),
    health: async () => ({ ok: scenarios.length > 0, latencyMs: 0 }),
  };
}
