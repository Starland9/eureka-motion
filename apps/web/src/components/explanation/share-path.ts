import type { ExplanationState } from "./types";

export function sharePathOf(
  state: Pick<ExplanationState, "id" | "status" | "language" | "shareUrl"> | null,
): string | null {
  if (state === null || state.id === null) return null;
  if (state.status !== "ready" && state.status !== "partial") return null;
  return state.shareUrl ?? `/${state.language}/e/${state.id}`;
}
