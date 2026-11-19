"use client";

import { useEffect, useState } from "react";
import {
  isPreparing,
  MAX_POLL_FAILURES,
  POLL_MS,
  readDeep,
  type DeepPhase,
  type DeepRead,
  type DeepStatus,
} from "./deep-version";

export type DeepView =
  | { kind: "hidden" }
  | { kind: "preparing"; phase: DeepPhase; since: number | null }
  | { kind: "ready"; url: string }
  | { kind: "unavailable" };

export interface DeepState {
  view: DeepView;
  announced: boolean;
}

const HIDDEN_VIEW: DeepView = { kind: "hidden" };
const UNAVAILABLE_VIEW: DeepView = { kind: "unavailable" };
const HIDDEN: DeepState = { view: HIDDEN_VIEW, announced: false };

function viewOf(read: Extract<DeepRead, { kind: "answer" }>): DeepView {
  if (isPreparing(read.status)) {
    return { kind: "preparing", phase: read.status, since: read.queuedAt };
  }
  if (read.status === "ready" && read.resultUrl !== null) {
    return { kind: "ready", url: read.resultUrl };
  }
  return read.status === "abandoned" ? UNAVAILABLE_VIEW : HIDDEN_VIEW;
}

function initialState(initial: DeepStatus | null): DeepState {
  if (isPreparing(initial)) {
    return { view: { kind: "preparing", phase: initial, since: null }, announced: false };
  }
  return initial === "abandoned" ? { view: UNAVAILABLE_VIEW, announced: false } : HIDDEN;
}

// Without a known status, a single read tells whether there is work or a video; it follows the
// job only when there is work. A failure never shows anything: the line goes away.
export function useDeepVersion(explanationId: string, initial: DeepStatus | null): DeepState {
  const [state, setState] = useState<DeepState>(() => initialState(initial));

  useEffect(() => {
    if (initial === "none" || initial === "abandoned") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let following = isPreparing(initial);

    const poll = async (): Promise<void> => {
      const read = await readDeep(explanationId, controller.signal);
      if (controller.signal.aborted) return;
      if (read.kind === "failed") {
        failures += 1;
        if (!following || failures >= MAX_POLL_FAILURES) {
          setState(HIDDEN);
          return;
        }
      } else {
        failures = 0;
        const view = viewOf(read);
        following = view.kind === "preparing";
        setState((previous) => ({
          view,
          announced:
            previous.announced || (previous.view.kind === "preparing" && view.kind === "ready"),
        }));
        if (!following) return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };

    if (following) timer = setTimeout(() => void poll(), POLL_MS);
    else void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [explanationId, initial]);

  return state;
}
