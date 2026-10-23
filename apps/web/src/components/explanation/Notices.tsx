"use client";

import { useTranslations } from "next-intl";
import type { Language } from "scene";
import { Button } from "@/components/ui/button";
import { ActionFeedback, useFailureText } from "./FinalState";
import { Notice } from "./Notice";
import type { ExplanationState } from "./types";
import { useRestartAction, type Restart } from "./useRestartAction";

interface NoticesProps {
  state: ExplanationState;
  restart: Restart;
  className?: string;
}

function suggestedLanguage(state: ExplanationState): Language | null {
  const detected = state.meta?.detectedLanguage;
  return (detected === "fr" || detected === "en") && detected !== state.language ? detected : null;
}

function sameQuestion(state: ExplanationState, language: Language = state.language) {
  return { question: state.question, language, level: state.level };
}

function Failure({ state, restart }: Omit<NoticesProps, "className">) {
  const t = useTranslations("Explanation.failed");
  const { pending, error, run } = useRestartAction(restart);
  const text = useFailureText(state.error);

  return (
    <Notice tone="alert">
      <div className="flex flex-wrap items-center gap-x-4">
        <p>{text}</p>
        {state.question === "" ? null : (
          <Button
            type="button"
            variant="link"
            disabled={pending !== null}
            onClick={() => void run("retry", sameQuestion(state))}
          >
            {t("retry")}
          </Button>
        )}
      </div>
      <ActionFeedback pending={pending !== null} error={error} pendingText={t("pending")} />
    </Notice>
  );
}

function Partial({ state, restart }: Omit<NoticesProps, "className">) {
  const t = useTranslations("Explanation.partial");
  const { pending, error, run } = useRestartAction(restart);

  return (
    <Notice tone="alert">
      <div className="flex flex-wrap items-center gap-x-4">
        <p>{t("notice")}</p>
        {state.question === "" ? null : (
          <Button
            type="button"
            variant="link"
            disabled={pending !== null}
            onClick={() => void run("restart", sameQuestion(state))}
          >
            {t("action")}
          </Button>
        )}
      </div>
      <ActionFeedback pending={pending !== null} error={error} pendingText={t("pending")} />
    </Notice>
  );
}

function Redirected() {
  const t = useTranslations("Explanation.redirected");
  return (
    <Notice>
      <p>{t("notice")}</p>
    </Notice>
  );
}

function LanguageSuggestion({
  state,
  language,
  restart,
}: Omit<NoticesProps, "className"> & { language: Language }) {
  const t = useTranslations("Explanation.language");
  const { pending, error, run } = useRestartAction(restart);
  const name = t(`names.${language}`);

  return (
    <Notice>
      <div className="flex flex-wrap items-center gap-x-4">
        <p>{t("notice", { language: name })}</p>
        <Button
          type="button"
          variant="link"
          disabled={pending !== null}
          onClick={() => void run("language", sameQuestion(state, language))}
        >
          {t("action", { language: name })}
        </Button>
      </div>
      <ActionFeedback pending={pending !== null} error={error} pendingText={t("pending")} />
    </Notice>
  );
}

export function Notices({ state, restart, className }: NoticesProps) {
  const language = state.question === "" ? null : suggestedLanguage(state);
  const failed = state.status === "failed" && state.scenes.length > 0;
  const partial = state.status === "partial";

  if (!failed && !partial && language === null && !state.redirected) return null;
  return (
    <div data-slot="notices" className={className}>
      {state.redirected ? <Redirected /> : null}
      {failed ? <Failure state={state} restart={restart} /> : null}
      {partial ? <Partial state={state} restart={restart} /> : null}
      {language === null ? null : (
        <LanguageSuggestion state={state} language={language} restart={restart} />
      )}
    </div>
  );
}
