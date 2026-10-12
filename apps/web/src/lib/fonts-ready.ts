"use client";

import { useSyncExternalStore } from "react";
import { FONT_FACES } from "scene";

const KATEX_FACES = ['1em "KaTeX_Main"', 'italic 1em "KaTeX_Math"'];
const TIMEOUT_MS = 3000;

let ready = false;
let started = false;
const listeners = new Set<() => void>();

function finish(): void {
  if (ready) return;
  ready = true;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  const faces = FONT_FACES.map(
    (face) => `${face.style} ${face.weight.split(" ")[0]} 1em "${face.family}"`,
  );
  // A font that never arrives must not block playback: fallbacks have the same metrics.
  const timer = setTimeout(finish, TIMEOUT_MS);
  void Promise.allSettled([...faces, ...KATEX_FACES].map((face) => document.fonts.load(face))).then(
    () => {
      clearTimeout(timer);
      finish();
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useFontsReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  );
}
