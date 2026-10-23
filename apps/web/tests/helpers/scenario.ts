import { DocumentSchema, type Outline, type Quiz, type Scene } from "scene";
import type { Scenario, ScenarioStep } from "../../src/server/llm/fixture";
import { FOLLOWUP_CHECK_MARKER, modeMarker } from "../../src/server/pipeline/prompts/modes";
import { OUTLINE_MARKER } from "../../src/server/pipeline/prompts/outline";
import { QUIZ_MARKER } from "../../src/server/pipeline/prompts/quiz";
import { sceneMarker } from "../../src/server/pipeline/prompts/scene";
import { TriageSchema } from "../../src/server/pipeline/prompts/schemas";
import { quoteStudent } from "../../src/server/pipeline/prompts/shared";

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
  quiz?: StepPatch;
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

export function quizOf(reference: ReferenceFile): Quiz {
  const { quiz } = DocumentSchema.parse(reference.payload);
  if (!quiz) throw new Error(`Reference ${reference.slug} has no quiz`);
  return quiz;
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
  const quiz: ScenarioStep[] = options.quiz
    ? [{ role: "author", when: QUIZ_MARKER, response: quizOf(reference), ...options.quiz }]
    : [];
  return {
    name: options.name ?? reference.slug,
    question: options.question ?? reference.question,
    steps: [...(options.prepend ?? []), triage, outline, judge, ...scenes, ...checkers, ...quiz],
  };
}

const PREPARATION_DELAY_MS = 900;

export const FOLLOWUP_QUESTION = "la distance double";
export const UNRELATED_QUESTION = "comment les plantes fabriquent-elles leur sucre ?";

const SPEAKER = {
  name: "Le haut-parleur qu'on entend moins de loin",
  mapping:
    "Le haut-parleur joue le rôle de la masse ; le son reçu joue le rôle de la force ; il faiblit comme le carré de la distance.",
};

const SPEAKER_WORDS: [string, string][] = [
  ["Comme la lumière d'une lampe", "Comme le son d'un haut-parleur"],
  [
    "Pense à une lampe. Plus tu recules, moins elle t'éclaire : tu l'as déjà remarqué.",
    "Pense à un haut-parleur. Plus tu recules, moins tu l'entends : tu l'as déjà remarqué.",
  ],
  ["Deux fois moins de lumière ? Non", "Deux fois moins de son ? Non"],
  ["quatre fois moins de lumière.", "quatre fois moins de son."],
  ["comme pour la lampe", "comme pour le haut-parleur"],
  ["la lumière reçue à 1, 2 et 3 mètres", "le son reçu à 1, 2 et 3 mètres"],
];

function reworded<T>(value: T, words: readonly [string, string][]): T {
  const text = words.reduce((all, [from, to]) => all.replaceAll(from, to), JSON.stringify(value));
  return JSON.parse(text) as T;
}

function retitled(scene: Scene, title: string): Scene {
  return { ...scene, title };
}

function withAnalogy(outline: Outline, analogy: Outline["plan"]["analogy"]): Outline {
  return { ...outline, plan: { ...outline.plan, analogy } };
}

const VALID_PLAN: ScenarioStep = {
  role: "judge",
  repeat: true,
  response: {
    verdict: "valid",
    issues: [],
    reason: "Le plan est exact : la force varie bien comme l'inverse du carré de la distance.",
  },
};

const VALID_SCENE: ScenarioStep = {
  role: "checker",
  when: SCENE_CHECK_KEY,
  repeat: true,
  response: {
    verdict: "valid",
    problem: "",
    reason: "La narration dit ce que dit le plan, sans rien y ajouter.",
  },
};

function sceneSteps(scenes: readonly Scene[]): ScenarioStep[] {
  return scenes.map<ScenarioStep>((scene, index) => ({
    role: "author",
    when: sceneMarker(index),
    response: scene,
  }));
}

function modeScenario(
  name: string,
  question: string,
  steps: ScenarioStep[],
  quiz?: ScenarioStep,
): Scenario {
  return { name, question, steps: [...steps, VALID_PLAN, VALID_SCENE, ...(quiz ? [quiz] : [])] };
}

export function modeScenarios(reference: ReferenceFile): Scenario[] {
  const outline = outlineOf(reference);
  const scenes = scenesOf(reference);
  const at = (...indexes: number[]): Scene[] => indexes.map((index) => scenes[index] as Scene);
  const speaker = (scene: Scene): Scene => reworded(scene, SPEAKER_WORDS);
  const speakerOutline = withAnalogy(reworded(outline, SPEAKER_WORDS), SPEAKER);
  const shown = (mode: "another_analogy" | "simpler" | "zoom" | "followup") => ({
    role: "author" as const,
    when: modeMarker(mode),
  });

  const another = modeScenario(
    "gravity.modes.another-analogy.fr",
    modeMarker("another_analogy"),
    [
      { ...shown("another_analogy"), response: speakerOutline, delayMs: PREPARATION_DELAY_MS },
      ...sceneSteps(scenes.map(speaker)),
    ],
    { role: "author", when: QUIZ_MARKER, response: quizOf(reference) },
  );

  const simpler = modeScenario("gravity.modes.simpler.fr", modeMarker("simpler"), [
    {
      ...shown("simpler"),
      response: {
        ...speakerOutline,
        plan: {
          ...speakerOutline.plan,
          prerequisites: speakerOutline.plan.prerequisites.slice(0, 2),
          steps: speakerOutline.plan.steps.filter((step) => step.role !== "formula"),
        },
      },
    },
    ...sceneSteps(at(0, 1, 2, 4, 5).map(speaker)),
  ]);

  const zoom = modeScenario("gravity.modes.zoom.fr", modeMarker("zoom"), [
    {
      ...shown("zoom"),
      response: {
        ...outline,
        plan: {
          ...outline.plan,
          objective:
            "Comprendre pourquoi les deux flèches restent égales quand la distance change.",
          key_rule: {
            statement: "La Terre et la Lune s'attirent avec des forces égales et opposées.",
          },
          steps: [
            {
              role: "mechanism",
              intent: "Voir que les deux flèches ont toujours la même longueur.",
              visual: "La Terre et la Lune, deux flèches F égales ; la Lune s'éloigne.",
            },
            {
              role: "mechanism",
              intent: "Voir que la distance change les deux flèches à la fois.",
              visual: "r double, les deux flèches F rétrécissent ensemble.",
            },
          ],
        },
      },
    },
    ...sceneSteps([
      retitled(at(2)[0] as Scene, "Deux flèches égales"),
      retitled(at(2)[0] as Scene, "La distance change les deux flèches"),
    ]),
  ]);

  const followup = modeScenario("gravity.modes.followup.fr", quoteStudent(FOLLOWUP_QUESTION), [
    {
      role: "triage",
      when: FOLLOWUP_CHECK_MARKER,
      response: { related: true, title: "Et si la distance double ?", detected_language: "fr" },
    },
    {
      ...shown("followup"),
      response: {
        ...outline,
        plan: {
          ...outline.plan,
          objective: "Voir que doubler la distance divise la force par quatre.",
          prerequisites: [],
          key_rule: {
            statement: "À distance double, la force d'attraction est quatre fois plus faible.",
            formula: outline.plan.key_rule.formula,
          },
          steps: [
            {
              role: "mechanism",
              intent: "Voir la force diminuer quand la Lune s'éloigne.",
              visual: "La Terre et la Lune ; r double, les flèches F rétrécissent.",
            },
            {
              role: "example",
              intent: "Comparer la force à r et à 2r.",
              visual: "Deux barres : F et F_2r, la seconde quatre fois plus courte.",
            },
          ],
        },
      },
    },
    ...sceneSteps(at(2, 4)),
  ]);

  const farAway: ReferenceFile = {
    ...reference,
    slug: "biology/photosynthesis",
    subject: "biology",
    title: "La photosynthèse",
  };
  const unrelated = modeScenario(
    "gravity.modes.unrelated.fr",
    quoteStudent(UNRELATED_QUESTION),
    [
      {
        role: "triage",
        when: FOLLOWUP_CHECK_MARKER,
        response: { related: false, title: "", detected_language: "fr" },
      },
      { ...shown("followup"), response: outline, delayMs: 40 },
      { role: "triage", response: acceptance(farAway) },
      { role: "author", when: OUTLINE_MARKER, response: outline },
      ...sceneSteps(scenes),
    ],
    { role: "author", when: QUIZ_MARKER, response: quizOf(reference) },
  );

  return [another, simpler, zoom, followup, unrelated];
}
