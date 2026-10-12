import { DocumentSchema, type Outline, type Scene } from "scene";
import type { Scenario, ScenarioStep } from "../../src/server/llm/fixture";
import { OUTLINE_MARKER } from "../../src/server/pipeline/prompts/outline";
import { sceneMarker } from "../../src/server/pipeline/prompts/scene";
import { TriageSchema } from "../../src/server/pipeline/prompts/schemas";

export interface ReferenceFile {
  slug: string;
  subject: string;
  language: string;
  title: string;
  question: string;
  payload: unknown;
}

type StepPatch = Partial<ScenarioStep>;

export interface ScenarioOptions {
  name?: string;
  question?: string;
  prepend?: ScenarioStep[];
  replace?: {
    triage?: StepPatch;
    outline?: StepPatch;
    judge?: StepPatch;
    scenes?: Record<number, StepPatch>;
  };
}

const SCENE_CHECK_KEY = "Step of the plan for this scene";
const JUDGE_KEY = "Concept:";

export function outlineOf(reference: ReferenceFile): Outline {
  const { plan, params, model } = DocumentSchema.parse(reference.payload);
  return { plan, params, model };
}

export function scenesOf(reference: ReferenceFile): Scene[] {
  return DocumentSchema.parse(reference.payload).scenes;
}

export function acceptance(reference: ReferenceFile): unknown {
  return TriageSchema.parse({
    decision: "accept",
    reason: "",
    concept: { slug: reference.slug, title: reference.title, subject: reference.subject },
    interpretations: [],
    detected_language: reference.language,
    deep_eligible: false,
  });
}

export function sceneIdKey(index: number): string {
  return `"id":"s${index + 1}"`;
}

export function brokenScene(scene: Scene, missing = "ghost"): Scene {
  const broken = structuredClone(scene);
  for (const beat of broken.beats) {
    for (const action of beat.actions) {
      if ("targets" in action) {
        action.targets = [...action.targets, missing];
        return broken;
      }
    }
  }
  throw new Error(`Scene ${scene.id} has no action with targets to break`);
}

export function draftSteps(reference: ReferenceFile, mark: string, repeat = false): ScenarioStep[] {
  const outline = outlineOf(reference);
  const tagged: Outline = {
    ...outline,
    plan: {
      ...outline.plan,
      objective: `[${mark}] ${outline.plan.objective}`,
      steps: outline.plan.steps.map((step, index) => ({
        ...step,
        visual: `[${mark}${index}] ${step.visual}`,
      })),
    },
  };
  return [
    { role: "author", when: OUTLINE_MARKER, response: tagged, repeat },
    ...scenesOf(reference).map<ScenarioStep>((scene) => ({
      role: "author",
      when: `[${mark}${scene.index}]`,
      response: { ...scene, title: `[${mark}] ${scene.title}` },
      repeat,
    })),
  ];
}

export function scenarioFromReference(
  reference: ReferenceFile,
  options: ScenarioOptions = {},
): Scenario {
  const replace = options.replace ?? {};
  const triage: ScenarioStep = {
    role: "triage",
    response: acceptance(reference),
    ...replace.triage,
  };
  const outline: ScenarioStep = {
    role: "author",
    when: OUTLINE_MARKER,
    response: outlineOf(reference),
    ...replace.outline,
  };
  const judge: ScenarioStep = {
    role: "judge",
    response: {
      verdict: "valid",
      issues: [],
      reason: "Le plan est exact : la force varie bien comme l'inverse du carré de la distance.",
    },
    ...replace.judge,
  };
  const scenes = scenesOf(reference).map<ScenarioStep>((scene) => ({
    role: "author",
    when: sceneMarker(scene.index),
    response: scene,
    ...replace.scenes?.[scene.index],
  }));
  const checkers: ScenarioStep[] = [
    {
      role: "checker",
      when: SCENE_CHECK_KEY,
      repeat: true,
      response: {
        verdict: "valid",
        problem: "",
        reason: "La narration dit ce que dit le plan, sans rien y ajouter.",
      },
    },
    {
      role: "checker",
      when: JUDGE_KEY,
      repeat: true,
      response: {
        verdict: "valid",
        issues: [],
        reason: "Le plan est exact : la force varie bien comme l'inverse du carré de la distance.",
      },
    },
  ];
  return {
    name: options.name ?? reference.slug,
    question: options.question ?? reference.question,
    steps: [...(options.prepend ?? []), triage, outline, judge, ...scenes, ...checkers],
  };
}
