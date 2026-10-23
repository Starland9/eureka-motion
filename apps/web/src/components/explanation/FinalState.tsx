"use client";

import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ExplanationState } from "./types";
import { useRestartAction, type Restart } from "./useRestartAction";

export function useFailureText(error: ExplanationState["error"]): string {
  const t = useTranslations("Explanation.failed");
  const message = error?.message.trim() ?? "";
  if (message !== "") return message;
  switch (error?.code) {
    case "connection_lost":
      return t("connection_lost");
    case "network":
      return t("network");
    default:
      return t("default");
  }
}

function Lead({ children }: { children: string }) {
  return <p className="text-lead max-w-prose text-pretty">{children}</p>;
}

function Next({ children }: { children: string }) {
  return <p className="text-body max-w-prose text-pretty text-ink-soft">{children}</p>;
}

function HomeLink({ label, className }: { label: string; className?: string }) {
  return (
    <Link href="/" className={cn(buttonVariants({ variant: "link" }), "self-start", className)}>
      {label}
    </Link>
  );
}

export function ActionFeedback({
  pending,
  error,
  pendingText,
}: {
  pending: boolean;
  error: string | null;
  pendingText: string;
}) {
  return (
    <>
      <p role="status" className="text-body text-ink-soft">
        {pending ? pendingText : null}
      </p>
      <div role="alert">
        {error === null ? null : (
          <p className="text-body max-w-prose border-l-2 border-role-action py-1 pl-3">{error}</p>
        )}
      </div>
    </>
  );
}

function Refused({ state }: { state: ExplanationState }) {
  const t = useTranslations("Explanation.refused");
  return (
    <>
      {state.refusal ? <Lead>{state.refusal}</Lead> : null}
      <Next>{t("next")}</Next>
      <HomeLink label={t("action")} />
    </>
  );
}

function Clarify({ state, restart }: { state: ExplanationState; restart: Restart }) {
  const t = useTranslations("Explanation.clarify");
  const { pending, error, run } = useRestartAction(restart);
  const interpretations = state.clarify?.interpretations ?? [];

  return (
    <>
      <Lead>{state.clarify?.reason ?? ""}</Lead>
      <Next>{t("next")}</Next>
      <ul className="border-t border-ink">
        {interpretations.map((interpretation, index) => {
          const chosen = pending === interpretation.question;
          return (
            <li key={interpretation.question} className="border-b border-rule">
              <button
                type="button"
                disabled={pending !== null}
                aria-busy={chosen || undefined}
                onClick={() =>
                  void run(interpretation.question, {
                    question: state.question,
                    language: state.language,
                    level: state.level,
                    interpretation: interpretation.question,
                  })
                }
                className={cn(
                  "touch-target text-body-l flex w-full cursor-pointer items-baseline gap-3 border-l-2 px-3 py-3 text-left hover:bg-surface-sunk disabled:cursor-default disabled:hover:bg-transparent",
                  chosen ? "border-ink" : "border-transparent disabled:text-ink-faint",
                )}
              >
                <span className="text-data text-ink-soft">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span lang={state.language} className="min-w-0 flex-1 text-pretty break-words">
                  {interpretation.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ActionFeedback pending={pending !== null} error={error} pendingText={t("pending")} />
    </>
  );
}

function Failed({ state, restart }: { state: ExplanationState; restart: Restart }) {
  const t = useTranslations("Explanation.failed");
  const tRoot = useTranslations("Explanation");
  const { pending, error, run } = useRestartAction(restart);
  const text = useFailureText(state.error);
  const canRetry = state.question !== "";

  return (
    <>
      <Lead>{text}</Lead>
      <Next>{canRetry ? t("nextRetry") : t("nextHome")}</Next>
      <div className="flex flex-wrap items-center gap-x-6">
        {canRetry ? (
          <Button
            type="button"
            disabled={pending !== null}
            onClick={() =>
              void run("retry", {
                question: state.question,
                language: state.language,
                level: state.level,
              })
            }
          >
            {t("retry")}
          </Button>
        ) : null}
        <HomeLink label={tRoot("backHome")} className="self-center" />
      </div>
      <ActionFeedback pending={pending !== null} error={error} pendingText={t("pending")} />
    </>
  );
}

export function FinalState({ state, restart }: { state: ExplanationState; restart: Restart }) {
  switch (state.status) {
    case "refused":
      return <Refused state={state} />;
    case "clarify":
      return <Clarify state={state} restart={restart} />;
    case "failed":
      return <Failed state={state} restart={restart} />;
    default:
      return null;
  }
}
