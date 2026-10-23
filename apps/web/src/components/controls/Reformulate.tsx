"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { RejectionAlert, type Rejection } from "@/components/ask/Rejection";
import { Notice } from "@/components/explanation/Notice";
import { formatFigureNumber } from "@/components/player/scene-list-entries";
import { cn } from "@/lib/utils";

export type ReformulateMode = "another_analogy" | "simpler";

export interface SceneChoice {
  id: string;
  title: string;
}

export interface ReformulateProps {
  scenes: readonly SceneChoice[];
  activeSceneId: string | null;
  busy: boolean;
  rejection?: Rejection | null;
  onReformulate(mode: ReformulateMode): void;
  onZoom(sceneId: string): void;
  className?: string;
}

const CELL =
  "touch-target text-control flex min-h-12 w-full cursor-pointer flex-col items-start justify-start px-4 py-3 text-left text-ink enabled:hover:bg-surface-sunk enabled:active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-faint";

export function Reformulate({
  scenes,
  activeSceneId,
  busy,
  rejection = null,
  onReformulate,
  onZoom,
  className,
}: ReformulateProps) {
  const t = useTranslations("Reformulate");
  const id = useId();
  const titleId = `${id}-title`;
  const sceneId = `${id}-scene`;
  const busyId = `${id}-busy`;
  const needId = `${id}-need`;
  const alertId = `${id}-alert`;
  const [picked, setPicked] = useState<string | null>(null);

  const has = (candidate: string | null): candidate is string =>
    candidate !== null && scenes.some((scene) => scene.id === candidate);
  const designated = has(picked) ? picked : has(activeSceneId) ? activeSceneId : null;
  const position = scenes.findIndex((scene) => scene.id === designated);
  const scene = scenes[position];
  const entry = (index: number, title: string): string =>
    t("sceneEntry", { number: formatFigureNumber(index + 1), title });

  const busyNote = busy ? busyId : undefined;
  const zoomNote = busy ? busyId : scene === undefined ? needId : undefined;

  return (
    <section aria-labelledby={titleId} className={cn("@container", className)}>
      <h2 id={titleId} className="text-title">
        {t("title")}
      </h2>

      <div className="mt-4 grid grid-cols-1 divide-y divide-ink border border-ink @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0">
        {(["another_analogy", "simpler"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={busy}
            aria-describedby={busyNote}
            onClick={() => onReformulate(mode)}
            className={CELL}
          >
            {t(`choices.${mode}`)}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || scene === undefined}
          aria-describedby={zoomNote}
          onClick={() => {
            if (scene !== undefined) onZoom(scene.id);
          }}
          className={CELL}
        >
          <span>{t("choices.zoom")}</span>{" "}
          {scene === undefined ? null : (
            <span
              className={cn("text-data wrap-anywhere", busy ? "text-ink-faint" : "text-ink-soft")}
            >
              {entry(position, scene.title)}
            </span>
          )}
        </button>
      </div>

      <div id={busyId} role="status" className="mt-4 empty:mt-0">
        {busy ? <Notice className="max-w-prose">{t("busy")}</Notice> : null}
      </div>

      <div className="mt-4 max-w-lg">
        <label htmlFor={sceneId} className="text-caption mb-1 block text-ink-faint">
          {t("sceneLegend")}
        </label>
        <select
          id={sceneId}
          value={designated ?? ""}
          onChange={(event) => setPicked(event.target.value)}
          className="text-body touch-target block w-full min-w-0 cursor-pointer border-b-2 border-ink bg-transparent px-0 py-2 text-ink [&>option]:bg-surface-raised"
        >
          {designated === null ? (
            <option value="" disabled>
              {t("scenePlaceholder")}
            </option>
          ) : null}
          {scenes.map((choice, index) => (
            <option key={choice.id} value={choice.id}>
              {entry(index, choice.title)}
            </option>
          ))}
        </select>
        {scene === undefined ? (
          <p id={needId} className="text-body mt-2 text-ink-soft">
            {t("zoomNeedsScene")}
          </p>
        ) : null}
      </div>

      <RejectionAlert id={alertId} rejection={rejection} />
    </section>
  );
}
