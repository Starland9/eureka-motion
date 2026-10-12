import { randomInt } from "node:crypto";
import {
  createExplanationCache,
  createExplanationStore,
  createRateLimiter,
  getDb,
  type RateLimiter,
} from "./db";
import { getLlm } from "./llm";
import { getMediaDir } from "./media";
import { EventLogRegistry } from "./pipeline/events";
import type { ExplanationCache, ExplanationStore } from "./pipeline/ports";
import { Pipeline } from "./pipeline/run";
import { createVoiceService } from "./pipeline/voice";
import { getVoice } from "./tts";

const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const EXPLANATION_ID_LENGTH = 12;
export const EXPLANATION_ID_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/;

export function newExplanationId(): string {
  let id = "";
  for (let i = 0; i < EXPLANATION_ID_LENGTH; i += 1) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
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
