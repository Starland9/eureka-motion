"use client";

import type { ExplanationStream } from "@/components/explanation/types";

export function useExplanationStream(): ExplanationStream {
  return {
    state: null,
    startedHere: false,
    start: () => Promise.resolve({ kind: "rejected", code: "not_implemented", message: "" }),
    open: () => {},
    reset: () => {},
  };
}
