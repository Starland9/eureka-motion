"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { RejectionAlert, type Rejection } from "@/components/ask/Rejection";
import { Notice } from "@/components/explanation/Notice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const FOLLOW_UP_MAX_LENGTH = 500;
const SHOW_REMAINING_BELOW = 50;

export interface FollowUpProps {
  busy: boolean;
  rejection?: Rejection | null;
  onAsk(question: string): void;
  className?: string;
}

export function FollowUp({ busy, rejection = null, onAsk, className }: FollowUpProps) {
  const t = useTranslations("Reformulate.followUp");
  const id = useId();
  const fieldId = `${id}-field`;
  const hintId = `${id}-hint`;
  const noteId = `${id}-note`;
  const busyId = `${id}-busy`;
  const alertId = `${id}-alert`;
  const [text, setText] = useState("");

  const question = text.replace(/\s+/g, " ").trim();
  const remaining = FOLLOW_UP_MAX_LENGTH - text.length;
  const showNote = remaining <= SHOW_REMAINING_BELOW;

  function submit() {
    if (question === "" || busy) return;
    onAsk(question);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <div className="text-lead flex max-w-3xl gap-3">
        <label htmlFor={fieldId} className="shrink-0 pt-2 pb-3">
          {t("lead")}
        </label>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
          <div
            aria-hidden
            className={cn(
              "invisible col-start-1 row-start-1 pt-2 pb-3 break-words whitespace-pre-wrap",
              text === "" && "italic",
            )}
          >
            {`${text === "" ? t("placeholder") : text} `}
          </div>
          <textarea
            id={fieldId}
            name="followup"
            rows={1}
            value={text}
            maxLength={FOLLOW_UP_MAX_LENGTH}
            placeholder={t("placeholder")}
            enterKeyHint="send"
            autoComplete="off"
            aria-invalid={rejection !== null}
            aria-describedby={`${hintId} ${noteId} ${busyId} ${alertId}`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="peer col-start-1 row-start-1 block min-w-0 justify-self-stretch resize-none overflow-hidden bg-transparent pt-2 pb-3 break-words whitespace-pre-wrap text-ink placeholder:text-ink-faint placeholder:italic focus-visible:outline-none"
          />
          <div
            aria-hidden
            className={cn(
              "pointer-events-none col-start-1 row-start-1 self-end border-b-2 peer-focus-visible:border-b-4",
              rejection === null ? "border-ink" : "border-role-action",
            )}
          />
        </div>
        <span aria-hidden className="shrink-0 self-end pt-2 pb-3">
          {t("tail")}
        </span>
      </div>

      <RejectionAlert id={alertId} rejection={rejection} />

      <p id={hintId} className="text-body mt-4 max-w-prose text-ink-soft">
        {t("hint")}
      </p>
      <p id={noteId} className={cn("text-data text-ink-soft", showNote && "mt-2")}>
        {showNote ? t("remaining", { count: remaining }) : null}
      </p>

      <div id={busyId} role="status" className="mt-4 empty:mt-0">
        {busy ? <Notice className="max-w-prose">{t("busy")}</Notice> : null}
      </div>

      <div className="mt-4">
        <Button
          type="submit"
          variant="secondary"
          disabled={question === "" || busy}
          aria-describedby={busy ? busyId : undefined}
        >
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
