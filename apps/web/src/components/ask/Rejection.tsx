import { CircleAlert } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { StartOutcome } from "@/components/explanation/types";
import { cn } from "@/lib/utils";

type Rejected = Extract<StartOutcome, { kind: "rejected" }>;
export type AskTranslate = ReturnType<typeof useTranslations<"Ask">>;

export interface Rejection {
  message: string;
  degraded: boolean;
}

function rejectionMessage(t: AskTranslate, outcome: Rejected): string {
  if (outcome.code === "rate_limited") {
    const seconds = Math.ceil(outcome.retryAfterSeconds ?? 0);
    if (seconds <= 0) return t("errors.rateLimitedLater");
    if (seconds <= 60) return t("errors.rateLimitedSeconds", { seconds });
    return t("errors.rateLimitedMinutes", { minutes: Math.ceil(seconds / 60) });
  }
  if (outcome.code === "generation_unavailable") return t("errors.generationUnavailable");
  if (outcome.code === "network" || outcome.message.trim() === "") return t("errors.unreachable");
  return outcome.message;
}

export function describeRejection(t: AskTranslate, outcome: Rejected): Rejection {
  return {
    message: rejectionMessage(t, outcome),
    degraded: outcome.code === "generation_unavailable",
  };
}

export function RejectionAlert({ id, rejection }: { id: string; rejection: Rejection | null }) {
  const degraded = rejection?.degraded === true;
  return (
    <div id={id} role="alert">
      {rejection !== null && (
        <p
          className={cn(
            degraded ? "text-lead" : "text-body",
            "mt-4 flex max-w-prose items-start gap-3 border-l-2 border-role-action py-1 pl-3",
          )}
        >
          <CircleAlert
            aria-hidden
            className={cn(degraded ? "mt-1.5" : "mt-0.5", "size-5 shrink-0 text-role-action-text")}
          />
          {rejection.message}
        </p>
      )}
    </div>
  );
}
