"use client";

import type { ExplanationDocument } from "scene";
import { Colophon, type ColophonProps } from "@/components/colophon/Colophon";
import type { Verdict } from "@/server/pipeline/events";

const PLAN_CHECKS = ["structure", "model", "pedagogy", "accuracy"];
const SCENE_CHECKS = ["structure", "references", "model", "readability", "framing", "pedagogy"];

function verdict(target: string, overrides: Partial<Verdict> = {}): Verdict {
  const scene = target !== "plan";
  return {
    target,
    status: "validated",
    attempts: 1,
    reason: "Le contrôle n’a relevé aucune erreur.",
    checks: scene ? [...SCENE_CHECKS, "accuracy"] : PLAN_CHECKS,
    ...overrides,
  };
}

function complete(document: ExplanationDocument): ColophonProps {
  return {
    plan: document.plan,
    scenes: document.scenes,
    verdicts: ["plan", ...document.scenes.map((scene) => `s${scene.index + 1}`)].map((target) =>
      verdict(target),
    ),
    sceneCount: document.scenes.length,
    dropped: [],
    generator: { provider: "anthropic", model: "claude-sonnet-5-5" },
    timings: {
      triage: 1320,
      outline: 6840,
      verify_plan: 10260,
      first_scene: 14130,
      scenes: 38720,
      quiz: 41980,
      total: 42350,
    },
    language: "fr",
    review: { reviewer: "Claire Mercier, professeure de physique", date: "2026-09-18" },
  };
}

function mixed(document: ExplanationDocument): ColophonProps {
  const kept = document.scenes.filter((scene) => scene.index !== 3);
  return {
    plan: document.plan,
    scenes: kept,
    verdicts: [
      verdict("plan", { checks: ["structure", "model", "pedagogy", "accuracy:fallback"] }),
      verdict("s1"),
      verdict("s2", {
        status: "corrected",
        attempts: 2,
        reason:
          "La première version indiquait une distance sans unité et une barre trop courte pour l’échelle ; la seconde corrige l’étiquette et recalcule la hauteur à partir de la distance.",
      }),
      verdict("s3"),
      verdict("s4", {
        status: "dropped",
        attempts: 3,
        reason:
          "Après trois tentatives, la formule affichée ne correspondait toujours pas à la règle du plan : la scène est écartée plutôt que de montrer une relation inexacte.",
        checks: SCENE_CHECKS,
      }),
      verdict("s5"),
      verdict("s6"),
    ],
    sceneCount: document.scenes.length,
    dropped: [3],
    generator: { provider: "anthropic", model: "claude-sonnet-5-5" },
    timings: { first_scene: 11870 },
    language: "fr",
  };
}

function inProgress(document: ExplanationDocument): ColophonProps {
  return {
    plan: document.plan,
    scenes: document.scenes.slice(0, 2),
    verdicts: [verdict("plan"), verdict("s1"), verdict("s2")],
    sceneCount: document.scenes.length,
    dropped: [],
    generator: { provider: "anthropic", model: "claude-sonnet-5-5" },
    timings: {},
    language: "fr",
  };
}

export function ColophonWorkbench({ document }: { document: ExplanationDocument }) {
  const instances: [string, string, ColophonProps][] = [
    ["complete", "Complete: all validated, generator, timings, review", complete(document)],
    ["mixed", "Mixed: one corrected, one dropped, partial timings, no review", mixed(document)],
    ["progress", "In progress: two scenes out of six, no timings", inProgress(document)],
  ];
  return (
    <main id="content" className="page-width space-y-16 py-8">
      {instances.map(([name, caption, props]) => (
        <section key={name} data-testid={`colophon-${name}`} aria-label={name}>
          <p className="text-data mb-3 text-ink-faint">{caption}</p>
          <Colophon {...props} />
        </section>
      ))}
    </main>
  );
}
