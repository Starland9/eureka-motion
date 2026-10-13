"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { StartOutcome, StartRequest } from "./types";

export type Restart = (request: StartRequest) => Promise<StartOutcome>;

type Rejected = Extract<StartOutcome, { kind: "rejected" }>;
type Translate = ReturnType<typeof useTranslations<"Ask.errors">>;

function rejectionMessage(t: Translate, outcome: Rejected): string {
  if (outcome.code === "rate_limited") {
    const seconds = Math.ceil(outcome.retryAfterSeconds ?? 0);
    if (seconds <= 0) return t("rateLimitedLater");
    if (seconds <= 60) return t("rateLimitedSeconds", { seconds });
    return t("rateLimitedMinutes", { minutes: Math.ceil(seconds / 60) });
  }
  if (outcome.code === "network" || outcome.message.trim() === "") return t("unreachable");
  return outcome.message;
}

export function useRestartAction(restart: Restart) {
  const t = useTranslations("Ask.errors");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, request: StartRequest): Promise<void> {
    if (pending !== null) return;
    setPending(key);
    setError(null);
    const outcome = await restart(request);
    if (outcome.kind === "accepted") return;
    setPending(null);
    if (outcome.code !== "superseded") setError(rejectionMessage(t, outcome));
  }

  return { pending, error, run };
}
