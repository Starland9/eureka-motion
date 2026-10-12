"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { Language } from "scene";
import type { ExplanationState } from "@/components/explanation/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { MakingSection } from "./MakingSection";
import { NarrationSection } from "./NarrationSection";
import { PlanSection } from "./PlanSection";
import { checkSets, verificationRows } from "./rows";
import { VerificationSection } from "./VerificationSection";

export interface ColophonProps {
  plan: ExplanationState["plan"];
  scenes: ExplanationState["scenes"];
  verdicts: ExplanationState["verdicts"];
  sceneCount: number | null;
  dropped: readonly number[];
  generator: ExplanationState["generator"];
  timings: ExplanationState["timings"];
  language: Language;
  review?: { reviewer: string; date: string };
  defaultOpen?: boolean;
  className?: string;
}

export function Colophon({
  plan,
  scenes,
  verdicts,
  sceneCount,
  dropped,
  generator,
  timings,
  language,
  review,
  defaultOpen = false,
  className,
}: ColophonProps) {
  const t = useTranslations("Colophon");
  const [open, setOpen] = useState(defaultOpen);
  // Radix drops aria-controls while closed; the hidden content element keeps its id.
  const contentId = useId();
  if (plan === null) return null;

  const rows = verificationRows({ plan, scenes, verdicts, sceneCount, dropped });
  const narrated = [...scenes].sort((a, b) => a.index - b.index);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("border-t border-ink", className)}
    >
      <h2>
        <CollapsibleTrigger
          aria-controls={contentId}
          className="gap-6 py-2 after:content-none data-open:after:content-none"
        >
          <span className="text-caption">{t("heading")}</span>
          <span aria-hidden="true" className="text-caption shrink-0">
            {open ? t("hide") : t("show")}
          </span>
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent id={contentId} className="pt-4 pb-10">
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 lg:grid-cols-2">
          <PlanSection plan={plan} language={language} />
          <VerificationSection rows={rows} checks={checkSets(verdicts)} language={language} />
        </div>
        {narrated.length > 0 ? (
          <NarrationSection scenes={narrated} language={language} className="mt-10" />
        ) : null}
        <MakingSection generator={generator} timings={timings} review={review} className="mt-10" />
      </CollapsibleContent>
    </Collapsible>
  );
}
