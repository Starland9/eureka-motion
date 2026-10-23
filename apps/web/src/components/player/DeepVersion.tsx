"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDeepStatus, type DeepStatus } from "./deep-version";
import { useDeepVersion } from "./useDeepVersion";

export interface DeepInitial {
  status: string;
}

interface DeepVersionProps {
  explanationId: string;
  initial?: DeepInitial | null;
  className?: string;
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
        {view.kind === "preparing" ? t("preparing") : null}
        {announced ? <span className="sr-only">{t("ready")}</span> : null}
      </p>
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
