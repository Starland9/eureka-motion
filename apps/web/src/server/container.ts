import { randomInt } from "node:crypto";
import {
  createExplanationCache,
  createExplanationStore,
  createJobs,
  createRateLimiter,
  getDb,
  type Jobs,
  type RateLimiter,
} from "./db";
import { getLlm } from "./llm";
import { getMediaDir } from "./media";
import { EventLogRegistry } from "./pipeline/events";
import type { ExplanationCache, ExplanationStore } from "./pipeline/ports";
import { createQuizWriter } from "./pipeline/quiz";
import { Pipeline } from "./pipeline/run";
import { readWorkerHealth } from "./health/workers";
import { loadReferenceRecord } from "./reference";
import { createVoiceService } from "./pipeline/voice";
import { getVoice } from "./tts";

const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const EXPLANATION_ID_LENGTH = 12;
export const EXPLANATION_ID_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/;

export function newExplanationId(): string {
  let id = "";
  for (let i = 0; i < EXPLANATION_ID_LENGTH; i += 1)
    id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

export function sharePath(id: string, language: string): string {
  return `/${language}/e/${id}`;
}

export interface Container {
  pipeline: Pipeline;
  store: ExplanationStore;
  cache: ExplanationCache;
  limiter: RateLimiter;
  logs: EventLogRegistry;
}

function build(): Container {
  const db = getDb();
  const store = createExplanationStore(db);
  const cache = createExplanationCache(db);
  const logs = new EventLogRegistry();
  const pipeline = new Pipeline(
    {
      llm: getLlm(),
      store,
      cache,
      voice: createVoiceService({ chain: getVoice(), mediaDir: getMediaDir() }),
      newId: newExplanationId,
      now: () => new Date(),
      shareUrl: sharePath,
      findReference: loadReferenceRecord,
      writeQuiz: createQuizWriter(getLlm()),
      enqueueDeep: async (explanationId) => {
        await getJobs().enqueue(explanationId, "deep");
        return (await readWorkerHealth()).render_worker;
      },
    },
    logs,
  );
  return { pipeline, store, cache, limiter: createRateLimiter(db), logs };
}

const holder = globalThis as typeof globalThis & { __eurekaContainer?: Container };

export function getContainer(): Container {
  holder.__eurekaContainer ??= build();
  return holder.__eurekaContainer;
}

export function setContainerForTests(container: Container | undefined): void {
  holder.__eurekaContainer = container;
}

const jobsHolder = globalThis as typeof globalThis & { __eurekaJobs?: Jobs };

export function getJobs(): Jobs {
  jobsHolder.__eurekaJobs ??= createJobs(getDb());
  return jobsHolder.__eurekaJobs;
}

export function setJobsForTests(jobs: Jobs | undefined): void {
  jobsHolder.__eurekaJobs = jobs;
}
