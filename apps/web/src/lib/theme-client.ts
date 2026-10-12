"use client";

import { useSyncExternalStore } from "react";
import type { ThemeName } from "scene";
import { THEME_STORAGE_KEY } from "./theme";

const CHANGE_EVENT = "eureka:theme";

function read(): ThemeName {
  return document.documentElement.classList.contains("dark") ? "board" : "paper";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setTheme(theme: ThemeName): void {
  document.documentElement.classList.toggle("dark", theme === "board");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable; the class on <html> is enough for this visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, read, () => "paper");
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
