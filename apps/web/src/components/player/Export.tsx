"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Notice } from "@/components/explanation/Notice";
import { sharePathOf } from "@/components/explanation/share-path";
import type { ExplanationState } from "@/components/explanation/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ANNOUNCE_STEP,
  announcedPercent,
  exportFilename,
  percentOf,
  type Problem,
} from "./export-job";
import { useExportJob, type ExportPhase } from "./useExportJob";

type Translate = ReturnType<typeof useTranslations<"Export">>;

// The room of the action and its status line: the page below does not move as the health comes in.
const RESERVED = "text-body min-h-[calc(2.75rem+1lh)]";

function exportableId(state: ExplanationState | null): string | null {
  return state !== null && sharePathOf(state) !== null ? state.id : null;
}

function isRenderWorkerUp(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { checks } = body as { checks?: unknown };
  return (
    typeof checks === "object" &&
    checks !== null &&
    (checks as { render_worker?: unknown }).render_worker === true
  );
}

function useRenderWorker(): boolean | null {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json() as Promise<unknown>)
      .then((body) => setUp(isRenderWorkerUp(body)))
      .catch(() => {
        if (!controller.signal.aborted) setUp(false);
      });
    return () => controller.abort();
  }, []);

  return up;
}

function problemText(t: Translate, problem: Problem): string {
  if (problem.code !== "rateLimited") return t(`errors.${problem.code}`);
  const seconds = Math.ceil(problem.retryAfterSeconds ?? 0);
  if (seconds <= 0) return t("errors.rateLimitedLater");
  if (seconds <= 60) return t("errors.rateLimitedSeconds", { seconds });
  return t("errors.rateLimitedMinutes", { minutes: Math.ceil(seconds / 60) });
}

function statusOf(t: Translate, phase: ExportPhase): { text: string; shown: boolean } {
  switch (phase.kind) {
    case "idle":
      return { text: phase.cancelled ? t("progress.cancelled") : "", shown: true };
    case "requesting":
      return { text: t("progress.starting"), shown: false };
    case "following": {
      if (phase.busy) return { text: t("progress.busy"), shown: true };
      const percent = announcedPercent(phase.progress);
      const text =
        percent < ANNOUNCE_STEP ? t("progress.starting") : t("progress.text", { percent });
      return { text, shown: false };
    }
    case "done":
      return { text: t("ready"), shown: true };
    case "failed":
      return { text: "", shown: true };
  }
}

function ExportJob({
  explanationId,
  title,
  className,
}: {
  explanationId: string;
  title: string;
  className?: string;
}) {
  const t = useTranslations("Export");
  const { phase, request, cancel, container, attachPrimary } = useExportJob(explanationId);
  const status = statusOf(t, phase);
  const running =
    phase.kind === "following" && (phase.status === "queued" || phase.status === "running")
      ? phase
      : null;
  const percent = running === null ? 0 : percentOf(running.progress);

  let control;
  if (running !== null) {
    control = (
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={t("progress.label")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-0.5 w-full bg-rule"
        >
          <div
            className="h-full origin-left bg-ink transition-transform duration-base ease-steady"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <p aria-hidden="true" className="text-data text-ink-soft">
            {t("progress.text", { percent })}
          </p>
          <Button type="button" variant="link" ref={attachPrimary} onClick={cancel}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  } else if (phase.kind === "done") {
    control = (
      <Button asChild variant="link" className="self-start">
        <a ref={attachPrimary} href={phase.url} download={exportFilename(title, explanationId)}>
          {t("download")}
        </a>
      </Button>
    );
  } else {
    control = (
      <Button
        type="button"
        variant="link"
        className="self-start"
        ref={attachPrimary}
        aria-disabled={phase.kind === "requesting"}
        onClick={() => void request()}
      >
        {phase.kind === "failed" ? t("retry") : t("action")}
      </Button>
    );
  }

  return (
    <div data-slot="export" ref={container} className={cn("flex flex-col", className)}>
      {control}
      <div role="alert">
        {phase.kind === "failed" ? (
          <Notice tone="alert">
            <p>{problemText(t, phase.problem)}</p>
          </Notice>
        ) : null}
      </div>
      <p role="status" className="text-body min-h-[1lh] text-ink-soft">
        <span className={status.shown ? undefined : "sr-only"}>{status.text}</span>
      </p>
    </div>
  );
}

export function Export({
  state,
  className,
}: {
  state: ExplanationState | null;
  className?: string;
}) {
  const t = useTranslations("Export");
  const worker = useRenderWorker();
  const id = exportableId(state);
  if (id === null) return null;
  if (worker === null) return <div data-slot="export" className={cn(RESERVED, className)} />;

  if (!worker) {
    return (
      <div data-slot="export" className={cn(RESERVED, className)}>
        <p role="status" className="text-ink-faint">
          {t("unavailable")}
        </p>
      </div>
    );
  }
  const title = state?.meta?.title || state?.question || "";
  return <ExportJob key={id} explanationId={id} title={title} className={className} />;
}
