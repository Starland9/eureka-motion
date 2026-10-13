"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CircleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useExplanationSession } from "@/components/explanation/ExplanationSession";
import type { StartOutcome } from "@/components/explanation/types";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useChoicePreference } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { LEVEL_PREFERENCE_KEY, LEVELS } from "./Preferences";
import { forgetStoredDraft, setDraft, useDraft } from "./useDraft";

const MAX_LENGTH = 500;
const SHOW_REMAINING_BELOW = 50;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

type Rejected = Extract<StartOutcome, { kind: "rejected" }>;
type Translate = ReturnType<typeof useTranslations<"Ask">>;

function typeSize(length: number): string {
  if (length <= 40) return "text-display-xl";
  if (length <= 120) return "text-title lg:text-display-m";
  if (length <= 200) return "text-title";
  return "text-lead";
}

function rejectionMessage(t: Translate, outcome: Rejected): string {
  if (outcome.code === "rate_limited") {
    const seconds = Math.ceil(outcome.retryAfterSeconds ?? 0);
    if (seconds <= 0) return t("errors.rateLimitedLater");
    if (seconds <= 60) return t("errors.rateLimitedSeconds", { seconds });
    return t("errors.rateLimitedMinutes", { minutes: Math.ceil(seconds / 60) });
  }
  if (outcome.code === "network" || outcome.message.trim() === "") return t("errors.unreachable");
  return outcome.message;
}

export function AskSentence() {
  const t = useTranslations("Ask");
  const locale = useLocale();
  const router = useRouter();
  const session = useExplanationSession();
  const [level] = useChoicePreference(LEVEL_PREFERENCE_KEY, LEVELS, "lycee");
  const text = useDraft();
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const fieldId = `${id}-field`;
  const hintId = `${id}-hint`;
  const noteId = `${id}-note`;
  const alertId = `${id}-alert`;

  const remaining = MAX_LENGTH - text.length;
  const showNote = remaining <= SHOW_REMAINING_BELOW;
  const canSubmit = text.trim() !== "" && !pending;
  const size = typeSize(text.length);

  useEffect(() => {
    if (window.matchMedia(FINE_POINTER).matches) fieldRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!accepted) return;
    return () => setDraft("");
  }, [accepted]);

  async function submit() {
    const question = text.trim();
    if (question === "" || pending) return;
    setPending(true);
    setError(null);
    const outcome = await session.start({ question, language: locale, level });
    if (outcome.kind === "accepted") {
      forgetStoredDraft();
      setAccepted(true);
      router.push(`/e/${outcome.id}`);
      return;
    }
    setPending(false);
    setError(rejectionMessage(t, outcome));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor={fieldId} className="text-display-xl mb-3 block text-balance">
        {t("lead")}
      </label>
      <div className="grid">
        <div
          aria-hidden
          className={cn(
            size,
            "invisible col-start-1 row-start-1 -mx-3 px-3 pt-2 pb-3 break-words whitespace-pre-wrap",
            text === "" && "italic",
          )}
        >
          {`${text === "" ? t("placeholder") : text} `}
        </div>
        <textarea
          ref={fieldRef}
          id={fieldId}
          name="question"
          rows={1}
          value={text}
          maxLength={MAX_LENGTH}
          readOnly={pending}
          placeholder={t("placeholder")}
          enterKeyHint="send"
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={`${hintId} ${noteId} ${alertId}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className={cn(
            size,
            "peer col-start-1 row-start-1 -mx-3 block justify-self-stretch resize-none overflow-hidden bg-transparent px-3 pt-2 pb-3 break-words whitespace-pre-wrap text-ink placeholder:text-ink-faint placeholder:italic focus-visible:outline-none",
          )}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none col-start-1 row-start-1 self-end border-b-2 peer-focus-visible:border-b-4",
            error === null ? "border-ink" : "border-role-action",
          )}
        />
      </div>

      <div id={alertId} role="alert">
        {error !== null && (
          <p className="text-body mt-4 flex max-w-prose items-start gap-3 border-l-2 border-role-action py-1 pl-3">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-role-action-text" />
            {error}
          </p>
        )}
      </div>

      <p id={hintId} className="text-body mt-4 max-w-prose text-ink-soft">
        {t("hint")}
      </p>
      <p id={noteId} className={cn("text-data text-ink-soft", showNote && "mt-2")}>
        {showNote ? t("remaining", { count: remaining }) : null}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button type="submit" disabled={!canSubmit}>
          {t("submit")}
        </Button>
        <div role="status" className="text-body text-ink-soft">
          {pending ? t("pending") : null}
        </div>
      </div>
    </form>
  );
}
