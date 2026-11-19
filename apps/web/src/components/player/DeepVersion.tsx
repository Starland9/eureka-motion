"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDeepStatus, type DeepStatus } from "./deep-version";
import { useDeepVersion } from "./useDeepVersion";
import { useElapsedSeconds } from "./useElapsedSeconds";

const SEPARATOR = " · ";
const SECONDS_PER_MINUTE = 60;

export interface DeepInitial {
  status: string;
}

interface DeepVersionProps {
  explanationId: string;
  initial?: DeepInitial | null;
  className?: string;
}

function Elapsed({ since }: { since: number }) {
  const t = useTranslations("Deep");
  const total = useElapsedSeconds(since);
  const text =
    total < SECONDS_PER_MINUTE
      ? t("elapsedSeconds", { seconds: String(total) })
      : t("elapsedMinutes", {
          minutes: String(Math.floor(total / SECONDS_PER_MINUTE)),
          seconds: String(total % SECONDS_PER_MINUTE).padStart(2, "0"),
        });
  return (
    <span aria-hidden="true">
      {SEPARATOR}
      {text}
    </span>
  );
}

function DeepLine({
  explanationId,
  initial,
  className,
}: {
  explanationId: string;
  initial: DeepStatus | null;
  className?: string;
}) {
  const t = useTranslations("Deep");
  const hintId = useId();
  const { view, announced } = useDeepVersion(explanationId, initial);
  if (view.kind === "hidden") return null;

  return (
    <div data-slot="deep" className={cn("flex min-h-11 flex-col justify-center", className)}>
      <p role="status" className="text-caption text-ink-faint">
        {view.kind === "preparing" ? t(view.phase) : null}
        {view.kind === "unavailable" ? (
          <>
            {t("unavailable")} <span className="block">{t("failed")}</span>
          </>
        ) : null}
        {announced ? <span className="sr-only">{t("ready")}</span> : null}
      </p>
      {view.kind === "preparing" ? (
        <p data-slot="deep-estimate" className="text-caption text-ink-faint">
          {t("duration")}
          {view.since !== null ? <Elapsed since={view.since} /> : null}
        </p>
      ) : null}
      {view.kind === "ready" ? (
        <>
          <a
            href={view.url}
            target="_blank"
            rel="noopener"
            aria-describedby={hintId}
            className={cn(buttonVariants({ variant: "link" }), "self-start")}
          >
            {t("watch")}
          </a>
          <span id={hintId} className="sr-only">
            {t("newTab")}
          </span>
        </>
      ) : null}
    </div>
  );
}

// The key restarts the follow-up when the explanation or the announced status changes.
export function DeepVersion({ explanationId, initial, className }: DeepVersionProps) {
  const status = isDeepStatus(initial?.status) ? initial.status : null;
  return (
    <DeepLine
      key={`${explanationId}:${status ?? ""}`}
      explanationId={explanationId}
      initial={status}
      className={className}
    />
  );
}
