"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUSY_AFTER_MS,
  MAX_POLL_FAILURES,
  POLL_MS,
  readJob,
  submitExport,
  type JobStatus,
  type Problem,
} from "./export-job";

export type ExportPhase =
  | { kind: "idle"; cancelled: boolean }
  | { kind: "requesting" }
  | { kind: "following"; jobId: string; status: JobStatus; progress: number; busy: boolean }
  | { kind: "done"; url: string }
  | { kind: "failed"; problem: Problem };

const IDLE: ExportPhase = { kind: "idle", cancelled: false };
const CANCELLED: ExportPhase = { kind: "idle", cancelled: true };
const REQUESTING: ExportPhase = { kind: "requesting" };
const FAILED: ExportPhase = { kind: "failed", problem: { code: "failed" } };
const LOST: ExportPhase = { kind: "failed", problem: { code: "lost" } };

export function useExportJob(explanationId: string) {
  const [phase, setPhase] = useState<ExportPhase>(IDLE);
  const container = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  const submission = useRef<AbortController | null>(null);

  const attachPrimary = useCallback((node: HTMLElement | null) => {
    primary.current = node;
  }, []);

  // The control the student used is swapped for its successor: the focus follows it.
  const move = useCallback((next: ExportPhase) => {
    refocus.current = container.current?.contains(document.activeElement) === true;
    setPhase(next);
  }, []);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    primary.current?.focus({ preventScroll: true });
  });

  const jobId = phase.kind === "following" ? phase.jobId : null;
  useEffect(() => {
    if (jobId === null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let queuedSince: number | null = null;

    const poll = async (): Promise<void> => {
      const read = await readJob(jobId, controller.signal);
      if (controller.signal.aborted) return;
      if (read.kind === "gone") {
        move(FAILED);
        return;
      }
      if (read.kind === "retry") {
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          move(LOST);
          return;
        }
      } else {
        failures = 0;
        const { status, progress, resultUrl } = read.job;
        if (status === "failed" || (status === "succeeded" && resultUrl === null)) {
          move(FAILED);
          return;
        }
        if (status === "succeeded" && resultUrl !== null) {
          move({ kind: "done", url: resultUrl });
          return;
        }
        const now = Date.now();
        queuedSince = status === "queued" ? (queuedSince ?? now) : null;
        const busy = queuedSince !== null && now - queuedSince >= BUSY_AFTER_MS;
        move({ kind: "following", jobId, status, progress, busy });
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, move]);

  useEffect(
    () => () => {
      submission.current?.abort();
    },
    [],
  );

  const request = useCallback(async () => {
    if (submission.current !== null) return;
    const controller = new AbortController();
    submission.current = controller;
    move(REQUESTING);
    const result = await submitExport(explanationId, controller.signal);
    if (controller.signal.aborted) return;
    submission.current = null;
    move(
      result.kind === "problem"
        ? { kind: "failed", problem: result.problem }
        : {
            kind: "following",
            jobId: result.jobId,
            status: result.status,
            progress: 0,
            busy: false,
          },
    );
  }, [explanationId, move]);

  // Server side the job goes on: only the follow-up stops, and a new request finds the same job.
  const cancel = useCallback(() => move(CANCELLED), [move]);

  return { phase, request, cancel, container, attachPrimary };
}
