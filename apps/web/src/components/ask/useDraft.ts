"use client";

import { useSyncExternalStore } from "react";

const DRAFT_KEY = "eureka.draft";

const listeners = new Set<() => void>();
let draft = "";
let loaded = false;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot(): string {
  if (!loaded) {
    loaded = true;
    try {
      draft = sessionStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      // Storage may be unavailable; the draft then lives in memory only.
    }
  }
  return draft;
}

function persist(next: string): void {
  try {
    if (next === "") sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, next);
  } catch {
    // Storage may be unavailable; the draft then lives in memory only.
  }
}

export function setDraft(next: string): void {
  draft = next;
  loaded = true;
  persist(next);
  listeners.forEach((listener) => listener());
}

export function forgetStoredDraft(): void {
  persist("");
}

export function useDraft(): string {
  return useSyncExternalStore(subscribe, snapshot, () => "");
}
