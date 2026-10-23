"use client";

import { useEffect } from "react";
import { useFlagPreference } from "@/lib/preferences";
import type { ExplanationState } from "./types";

const OWNED_KEY_PREFIX = "eureka.mine.";

// The session flag is lost on a reload and on every navigation between versions, so the
// explanations started from this device are remembered. A reference has no owner.
export function useIsVisitor(
  state: Pick<ExplanationState, "id" | "reference"> | null,
  startedHere: boolean,
): boolean {
  const id = state?.id ?? null;
  const [owned, markOwned] = useFlagPreference(`${OWNED_KEY_PREFIX}${id ?? ""}`, false);

  useEffect(() => {
    if (startedHere && id !== null && !owned) markOwned(true);
  }, [startedHere, id, owned, markOwned]);

  return state !== null && state.reference === null && !startedHere && !owned;
}
