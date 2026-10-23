"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { Language, Model, Param, Scene } from "scene";
import { Colophon } from "@/components/colophon/Colophon";
import { FigureCaption } from "@/components/player/FigureCaption";
import { ParamsPanel } from "@/components/player/ParamsPanel";
import { Planche } from "@/components/player/Planche";
import { PlaybackProvider, type PlayableExplanation } from "@/components/player/PlaybackProvider";
import { SceneList } from "@/components/player/SceneList";
import { Share } from "@/components/player/Share";
import { Subtitles } from "@/components/player/Subtitles";
import { Transport } from "@/components/player/Transport";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useExplanationSession } from "./ExplanationSession";
import { ExplanationHeader } from "./ExplanationHeader";
import { FinalState } from "./FinalState";
import { GonePage } from "./GonePage";
import { LevelChoice } from "./LevelChoice";
import { Notices } from "./Notices";
import { PlancheOverlay } from "./PlancheOverlay";
import { PreparationRule, PreparationSteps } from "./Preparation";
import { QuizPanel } from "./QuizPanel";
import { ReformulatePanel } from "./ReformulatePanel";
import { sharePathOf } from "./share-path";
import {
  isComplete,
  type ExplanationState,
  type ExplanationStatus,
  type StartOutcome,
  type StartRequest,
} from "./types";
import { useIsVisitor } from "./useIsVisitor";
import { VisitorAsk } from "./VisitorAsk";

const NO_SCENES: readonly Scene[] = [];
const NO_PARAMS: readonly Param[] = [];
const NO_MODEL: Model = { constants: [], derived: [] };
const BLOCKING: ReadonlySet<ExplanationStatus> = new Set(["refused", "clarify", "failed"]);

function titleSize(text: string): string {
  if (text.length <= 36) return "text-title sm:text-display-m";
  if (text.length <= 100) return "text-title";
  return "text-lead";
}

export function ExplanationView({ id }: { id: string }) {
  const t = useTranslations("Explanation");
  const product = useTranslations("Common")("productName");
  const locale = useLocale();
  const router = useRouter();
  const session = useExplanationSession();
  const [frozen, setFrozen] = useState<ExplanationState | null>(null);

  const live = session.state?.id === id ? session.state : null;
  const state = frozen ?? live;
  const redirectTo = live?.redirectTo ?? null;

  const openIfNeeded = useEffectEvent(() => {
    if (live === null) session.open(id);
  });
  const isFrozen = frozen !== null;
  useEffect(() => {
    if (!isFrozen) openIfNeeded();
  }, [id, isFrozen]);

  useEffect(() => {
    if (redirectTo !== null && redirectTo !== id) router.replace(`/e/${redirectTo}`);
  }, [redirectTo, id, router]);

  const title = state?.meta?.title ?? "";
  useEffect(() => {
    if (title !== "") document.title = t("documentTitle", { title, product });
  }, [title, product, t]);

  const scenes = state?.scenes ?? NO_SCENES;
  const params = state?.params ?? NO_PARAMS;
  const model = state?.model ?? NO_MODEL;
  const language: Language = state?.language ?? (locale === "en" ? "en" : "fr");
  const complete = state !== null && isComplete(state);
  const explanation = useMemo<PlayableExplanation>(
    () => ({ scenes, params, model, language, complete }),
    [scenes, params, model, language, complete],
  );

  async function restart(request: StartRequest): Promise<StartOutcome> {
    setFrozen(state);
    const outcome = await session.start(request);
    if (outcome.kind === "accepted") {
      if (outcome.id === id) setFrozen(null);
      else router.push(`/e/${outcome.id}`, { locale: request.language });
    } else if (outcome.code === "superseded") {
      setFrozen(null);
    }
    return outcome;
  }

  const hasScenes = scenes.length > 0;
  const blocking = !hasScenes && state !== null && BLOCKING.has(state.status);
  const fromState = state?.meta?.title || state?.question || "";
  const heading = fromState || t("neutralTitle");
  const autoPlay = frozen === null && session.startedHere;
  const visitor = useIsVisitor(state, session.startedHere);

  if (state?.status === "missing" || state?.status === "expired") {
    return <GonePage kind={state.status} />;
  }

  return (
    <PlaybackProvider explanation={explanation} autoPlay={autoPlay}>
      <div className="flex min-h-dvh flex-col">
        <ExplanationHeader />
        <main id="content" className="page-width flex-1 pt-8 pb-16 lg:pt-12">
          <div
            className={cn(
              "grid gap-x-6 gap-y-6 lg:grid-cols-12",
              !blocking && "lg:grid-rows-[auto_1fr]",
            )}
          >
            <h1
              lang={fromState ? state?.language : undefined}
              className={cn(
                "min-w-0 text-balance break-words",
                titleSize(heading),
                blocking ? "lg:col-span-8" : "lg:col-span-4 lg:col-start-9 lg:row-start-1",
              )}
            >
              {heading}
            </h1>
            {blocking && state !== null ? (
              <div className="flex flex-col gap-6 lg:col-span-8">
                <FinalState state={state} restart={restart} />
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-col gap-4 lg:col-span-8 lg:col-start-1 lg:row-span-2 lg:row-start-1">
                  <Planche
                    className="m-0 mb-4 sm:m-0 sm:mb-4"
                    overlay={<PlancheOverlay preparing={!hasScenes} autoPlay={autoPlay} />}
                  />
                  {hasScenes ? (
                    <>
                      <FigureCaption />
                      <Transport plannedSceneCount={state?.sceneCount ?? undefined} />
                      <Subtitles className="mt-2" />
                    </>
                  ) : (
                    <PreparationRule steps={state?.steps ?? {}} />
                  )}
                  {state === null ? null : <Notices state={state} restart={restart} />}
                </div>
                <div className="min-w-0 lg:col-span-4 lg:col-start-9 lg:row-start-2">
                  <Share path={sharePathOf(state)} className="mb-6" />
                  {hasScenes ? (
                    <QuizPanel quiz={state?.quiz ?? null} explanationId={state?.id ?? null}>
                      <SceneList
                        plannedCount={state?.sceneCount ?? undefined}
                        dropped={state?.dropped}
                      />
                    </QuizPanel>
                  ) : (
                    <PreparationSteps
                      steps={state?.steps ?? {}}
                      sceneCount={state?.sceneCount ?? null}
                    />
                  )}
                  {state === null || visitor ? null : (
                    <LevelChoice state={state} className="mt-8" />
                  )}
                </div>
                {hasScenes ? (
                  <ParamsPanel className="lg:col-span-12 lg:col-start-1 lg:row-start-3 lg:mt-6" />
                ) : null}
                {visitor ? (
                  <VisitorAsk className="lg:col-span-12" />
                ) : (
                  <ReformulatePanel state={state} restart={restart} className="lg:col-span-12" />
                )}
              </>
            )}
          </div>
          {state === null || blocking ? null : (
            <Colophon
              className="mt-16"
              plan={state.plan}
              scenes={state.scenes}
              verdicts={state.verdicts}
              sceneCount={state.sceneCount}
              dropped={state.dropped}
              generator={state.generator}
              timings={state.timings}
              language={state.language}
            />
          )}
        </main>
      </div>
    </PlaybackProvider>
  );
}
