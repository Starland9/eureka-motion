"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { Language, Level, Scene } from "scene";
import { describeRejection, type Rejection } from "@/components/ask/Rejection";
import { FollowUp } from "@/components/controls/FollowUp";
import { Reformulate, type ReformulateProps } from "@/components/controls/Reformulate";
import { Versions } from "@/components/controls/Versions";
import { usePlaybackPosition } from "@/components/player/PlaybackProvider";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Restart } from "./useRestartAction";
import { useVersions } from "./useVersions";
import type { Derivation, ExplanationState } from "./types";

type Source = "choices" | "followup";

interface Refusal {
  source: Source;
  rejection: Rejection;
}

interface PanelProps {
  state: ExplanationState | null;
  restart: Restart;
  className?: string;
}

interface SectionProps {
  id: string;
  language: Language;
  level: Level;
  scenes: readonly Scene[];
  restart: Restart;
  className: string | undefined;
}

function ActiveSceneChoices(props: Omit<ReformulateProps, "activeSceneId">) {
  const { location } = usePlaybackPosition();
  return <Reformulate {...props} activeSceneId={location?.scene.id ?? null} />;
}

function Section({ id, language, level, scenes, restart, className }: SectionProps) {
  const tAsk = useTranslations("Ask");
  const router = useRouter();
  const versions = useVersions(id, language);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const choices = useMemo(
    () => scenes.map((scene) => ({ id: scene.id, title: scene.title })),
    [scenes],
  );

  async function derive(source: Source, question: string, derivation: Derivation) {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await restart({ question, language, level, derive: derivation });
    if (outcome.kind === "accepted") return;
    setBusy(false);
    if (outcome.code !== "superseded") {
      setRefusal({ source, rejection: describeRejection(tAsk, outcome) });
    }
  }

  const rejectionOf = (source: Source): Rejection | null =>
    refusal?.source === source ? refusal.rejection : null;

  return (
    <div
      data-slot="reformulate"
      className={cn("grid gap-x-6 gap-y-8 border-t border-ink pt-8 lg:grid-cols-12", className)}
    >
      <div className="flex min-w-0 flex-col gap-8 lg:col-span-8">
        <ActiveSceneChoices
          scenes={choices}
          busy={busy}
          rejection={rejectionOf("choices")}
          onReformulate={(mode) => void derive("choices", "", { mode, parentId: id })}
          onZoom={(sceneId) => void derive("choices", "", { mode: "zoom", parentId: id, sceneId })}
        />
        <FollowUp
          busy={busy}
          rejection={rejectionOf("followup")}
          onAsk={(question) =>
            void derive("followup", question, { mode: "followup", parentId: id })
          }
        />
      </div>
      <Versions
        versions={versions}
        currentId={id}
        onOpen={(versionId) => {
          if (versionId !== id) router.push(`/e/${versionId}`, { locale: language });
        }}
        className="min-w-0 lg:col-span-4"
      />
    </div>
  );
}

export function ReformulatePanel({ state, restart, className }: PanelProps) {
  if (state === null || state.id === null || state.scenes.length === 0) return null;
  if (state.status !== "ready" && state.status !== "partial") return null;
  return (
    <Section
      key={state.id}
      id={state.id}
      language={state.language}
      level={state.level}
      scenes={state.scenes}
      restart={restart}
      className={className}
    />
  );
}
