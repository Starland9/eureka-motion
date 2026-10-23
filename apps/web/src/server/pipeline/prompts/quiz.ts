import { DocumentSchema, type Outline, type Scene } from "scene";
import reference from "../../../../../../content/reference/physics.universal-gravitation.fr.json";
import { audienceBlock, type Audience, type Prompt } from "./shared";

export const QUIZ_MARKER = "QUIZ";

export interface QuizPromptInput extends Audience {
  outline: Outline;
  scenes: readonly Scene[];
}

const EXAMPLE_QUESTIONS = (DocumentSchema.parse(reference.payload).quiz?.questions ?? []).slice(
  0,
  2,
);

const TEMPLATE = /\{\{[^}]*\}\}/g;

function onScreen(scene: Scene): string[] {
  return scene.elements
    .flatMap((element) => {
      switch (element.type) {
        case "text":
          return [element.text];
        case "list":
          return element.items;
        case "object":
          return [element.label ?? element.kind];
        default:
          return [];
      }
    })
    .map((text) => text.replace(TEMPLATE, "…"));
}

function shown(scene: Scene) {
  return {
    id: scene.id,
    role: scene.role,
    title: scene.title,
    narration: scene.beats.map((beat) => beat.narration),
    on_screen: onScreen(scene),
  };
}

export function buildQuizPrompt(input: QuizPromptInput): Prompt {
  const system = `You are an expert teacher. You write the short quiz that follows an animated explanation on Eureka Motion: the student has just watched the scenes you are given, and the quiz checks that the main ideas went through. Reply with one JSON object.

${audienceBlock(input)}

What to ask
- 3 questions when the scenes carry three distinct ideas, otherwise 2. Never more than 3, never fewer than 2.
- Each question tests understanding of an idea the scenes showed or said: predict what happens when something changes, pick the right reason, apply the rule to a new case, spot a misconception. Never the recall of a word, a name or a number read on screen.
- Ask only about what the scenes under "Scenes shown" cover. The plan is context, not material: never ask about something only the plan mentions, nor about a scene listed as not shown.
- One question per idea, spread over different scenes when the scenes allow it.
- "scene_id" is the id of the scene that covers the point of the question, copied exactly from the list of scenes shown.
- Everything is correct at the level of the audience and consistent with the key rule of the plan. A question has exactly one defensible answer.
- Ask about relations (doubles, halves, grows, shrinks, stays the same), not about values you would have to compute: never put in a question or a choice a number that you calculated yourself.
- A question stands on its own: do not write "in the scene", "as said in the video", "in the figure".

Choices
- 3 or 4 choices per question, with the ids "a", "b", "c", "d" in that order.
- Exactly one choice is right. Each wrong choice is a plausible mistake at this level: a classic misconception, a relation inverted, a square forgotten, two quantities confused, a rule used outside its domain. Never a joke, never an absurdity, never a choice that is also true.
- The choices have the same form and about the same length: the right one is not the longest, the most precise or the only one with a nuance.
- No "all of the above", "none of the above" or "a and b".
- Do not always put the right answer at the same place: vary its position from one question to the next.

Texts
- prompt: the question, 160 characters at most. choices[].text: 70 characters at most. explanation: ONE sentence of 200 characters at most that says why the right answer is right; it is shown whichever choice the student made, so it never refers to a letter or a position.
- Plain text: no markdown, no TeX, no HTML. Write powers and indices with Unicode characters (r², m₁).

JSON shape
{ "questions": [{ "prompt": "…", "choices": [{ "id": "a", "text": "…" }, { "id": "b", "text": "…" }, { "id": "c", "text": "…" }], "answer_id": "b", "explanation": "…", "scene_id": "s3" }] }

Examples of questions, in French for high school
${EXAMPLE_QUESTIONS.map((question) => JSON.stringify(question)).join("\n")}`;

  const { plan } = input.outline;
  const ids = new Set(input.scenes.map((scene) => scene.id));
  const missing = plan.steps.map((_, index) => `s${index + 1}`).filter((id) => !ids.has(id));
  const lines = [
    QUIZ_MARKER,
    "Write the quiz now.",
    `Plan: ${JSON.stringify({ objective: plan.objective, key_rule: plan.key_rule.statement })}`,
    `Scenes shown (the only valid scene_id values: ${[...ids].join(", ")}):`,
    JSON.stringify(input.scenes.map(shown)),
  ];
  if (missing.length > 0) {
    lines.push(`Scenes not shown, do not ask about them: ${missing.join(", ")}`);
  }
  return { system, messages: [{ role: "user", content: lines.join("\n") }] };
}
