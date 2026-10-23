import {
  buildScope,
  defaultParamValues,
  formatNumber,
  toModelDefinition,
  type Outline,
} from "scene";
import { catalogFor } from "./catalog";
import { EXAMPLE_SCENES } from "./examples";
import type { Subject } from "./schemas";
import { audienceBlock, EXPRESSION_RULES, type Audience, type Prompt } from "./shared";

export interface SceneInput extends Audience {
  outline: Outline;
  index: number;
  subject: Subject;
  extra?: string | undefined;
}

function modelValues(outline: Outline): string {
  const model = toModelDefinition(outline);
  if (model.params.length === 0 && model.derived.length === 0) {
    return "The model has no parameter: the scene shows no computed number.";
  }
  const defaults = defaultParamValues(model.params);
  const corners: Record<string, number>[] = [defaults];
  for (const param of model.params) {
    corners.push({ ...defaults, [param.id]: param.min }, { ...defaults, [param.id]: param.max });
  }
  const scopes = corners.map((values) => buildScope(model, values));
  const show = (value: number): string => formatNumber(value, { kind: "sig", digits: 3 }, "en");
  const lines = [
    "Values the model takes (use them to choose `world` and to keep sweeps inside the ranges)",
  ];
  for (const param of outline.params) {
    lines.push(
      `- ${param.id}: from ${show(param.min)} to ${show(param.max)}, default ${show(param.default)} ${param.unit}`,
    );
  }
  for (const derived of model.derived) {
    const values = scopes.map((scope) => scope[derived.id] as number);
    lines.push(
      `- ${derived.id} = ${derived.expr}: ${show(values[0] as number)} at the defaults, between ${show(Math.min(...values))} and ${show(Math.max(...values))} over the ranges`,
    );
  }
  return lines.join("\n");
}

export function sceneMarker(index: number): string {
  return `SCENE ${index}`;
}

const EXPLANATION_SECONDS = 95;
const MAX_SCENE_SECONDS = 16;

function sceneSeconds(sceneCount: number): number {
  return Math.min(MAX_SCENE_SECONDS, Math.round(EXPLANATION_SECONDS / Math.max(1, sceneCount)));
}

export function buildScenePrompt(input: SceneInput): Prompt {
  const step = input.outline.plan.steps[input.index];
  if (!step) throw new Error(`The plan has no step ${input.index}`);

  const system = `You are the author of animated explanations for Eureka Motion. From a validated outline, you write ONE scene as a JSON description. You never write code: you choose a layout, place primitives in its slots, and script what happens while each sentence is narrated. An engine draws it. Reply with one JSON object.

${audienceBlock(input)}

The scene
{ "id", "index", "role", "title", "layout", "world", "derived", "elements", "beats" }
- id is "s" followed by index + 1. index and role are given to you.
- title: a caption of 60 characters at most, without a final period.
- layout: choose the one that serves the idea. Each layout has fixed slots; an element goes only in a slot of the chosen layout.
  - "statement": slot "text" (1 or 2 elements: text or list). One strong sentence or a short list, no figure.
  - "figure": slot "figure". One large figure, nothing else.
  - "figure-notes": slots "figure" and "notes". A figure, with at most 3 notes beside it: short texts of 10 words at most, or readouts.
  - "formula-focus": slots "formula" (exactly one formula), "figure", and "readout" (at most 3 readouts). There is no slot for text.
  - "compare": slots "figure_a" and "figure_b". Two figures side by side, no text.
  - "sequence": slot "track". A timeline or ordered steps, alone.
- world: the mathematical frame of the figure, { "x": [min, max], "y": [min, max] }. Required as soon as one element is positioned by coordinates; leave it out otherwise. Give it about the proportions of the figure slot (figure 8:3, figure-notes 5:3, formula-focus 11:4, compare 5:4) and keep every element inside 90 % of it for every value the parameters can take.
- derived: optional, up to 4 values computed for this scene only: [{ "id", "expr", "unit", "label", "format" }]. Use it for any number the scene needs that the outline does not provide (a position on screen, a ratio, a value at another point). An expression may read the parameters, constants and derived values of the outline, and the scene values declared before it. Give each a new id.
- elements: the primitives, each with a unique id and the slot it sits in.
- beats: 3 beats (4 at most, only when every sentence is very short), with ids "b1", "b2"… Each beat is one narrated sentence and the actions that happen while it is said.

Narration
- One short sentence per beat, 8 to 14 words, 120 characters at most. It is spoken aloud and shown as a subtitle. Speech runs at about 2.6 words a second: 12 words last 5 seconds.
- Talk to the student: "look", "guess", "you have seen this". Vary the rhythm: a short question, then the answer the figure gives.
- Say what the eye should look at, in the order it appears.
- Never state a number that depends on a parameter: the student can move the sliders and the spoken number would become false. Show it with a readout, or with {{id|format}} in a text.
- Stay within the intent of the step. Do not announce the next scene.

Watched, not read
- In every scene with a figure, something must move or change while the narration speaks: a "sweep" when the model has parameters, a "move" of an object (an apple that falls, a car that advances), a simulation that plays, or lines drawn one after the other as they are named. A figure that appears whole and then stays still is a failed scene.
- Guess, then see: when it fits, one beat asks the student what will happen and the next beat shows it.
- The screen does not repeat the voice. A note is a key word, a result or a live value, 6 words at most; two notes are usually enough. What the narration says in a sentence is not written again as a sentence.
- The "hook" scene shows the concrete situation with a figure ("compare", "figure" or "figure-notes"): objects from the pictogram library, something that happens to them, and the question it raises in the last beat. Use "statement" for the hook only when nothing can be drawn.
- The "recap" scene uses the "statement" layout with a list of two or three ideas, three beats at most; its last beat highlights the one item that answers the hook ("listId.i2" targets the second item).

Actions
- An element is invisible until a "show" action names it. Every element must be shown at some point.
- "draw" for lines, arrows and curves; "type" for texts and formulas; "fade" for the rest.
- Reveal progressively: what the sentence talks about appears while it is said.
- When the model has parameters, use "sweep" to make the figure react while you state the relation ("if the distance doubles…"). A sweep moves the parameter from its current value to "to" while the sentence is spoken, then brings it back; { "expr": "2 * r" } doubles it exactly. The target must stay inside the range of the parameter: check min and max in the outline before writing it.
- Never say something the scene does not show. If the range does not allow "three times as far", do not say it.
- "highlight" marks what must be remembered: one element or one item per scene, never a whole list. "focus" dims everything else for one beat.
- "move" carries an object to another place of the frame while the sentence is spoken; what is attached to it follows.
- A "tree" tells its story in order: show the nodes level by level ("treeId.nodeId"), then make the values climb from the leaves by showing "treeId.nodeId_value" for each inner node as the narration computes it, and highlight the nodes of the chosen path. Use it for anything that branches: a game tree, a recursion, a search, a decision, a classification. Never build a tree out of points and segments.
- Target one part of a simulation with "elementId.part".

Limits: the scene is rejected otherwise
- 14 elements at most; 8 labels at most visible together (hide what is no longer needed); 3 colour roles at most besides ink, so choose them: one for what varies, one for what acts, and the highlight.
- "result" is a highlighter: an element with the role "result" is drawn in ink over a yellow highlight. Use it for the one thing to remember, or use a "highlight" action.
- A slot holds at most: text 2, notes 3, formula 1, readout 3 elements.
- A simulation, a bar chart, a relations diagram, a tree, a table, a timeline or a list of steps fills its slot alone.
- A text element has 140 characters at most, and 70 at most in the "notes" slot (40 per item of a list there). A label is a word or a symbol.
- The labels of two elements must not sit on top of each other.
- An element may be attached to another one by its id only if that one is a point, an object or a shape of the same slot.
- An id is a parameter, a constant or a derived value of the outline, or a value of this scene's "derived". Never use a name that is declared nowhere, and never "sweep" anything but a parameter.
- A text or a readout goes in a text slot ("text", "notes", "readout"), never in a figure slot; a figure element never goes in a text slot.
- Use the ids, symbols and names of the outline. Bind every value that comes from the model: { "expr": "…" } for numbers, {{id|format}} in texts, a readout for a live value.
- Time "t" may appear only in the "fn" of a plot.
${EXPRESSION_RULES}

Prefer a simulation when it shows exactly the concept of the scene: it computes its positions from the law it shows and reacts to the sliders. Never borrow a simulation for another phenomenon because it looks alike (a wave simulation shows waves, not an electric current): draw the figure with segments, shapes and objects instead.

${catalogFor(input.subject)}

Outline
${JSON.stringify(input.outline)}

${modelValues(input.outline)}

Examples of valid scenes, in French for high school
${EXAMPLE_SCENES.map((scene) => JSON.stringify(scene)).join("\n")}`;

  const lines = [
    sceneMarker(input.index),
    `Write the scene with index ${input.index}, id "s${input.index + 1}", role "${step.role}".`,
    `Step of the plan: ${JSON.stringify(step)}`,
    `Time: the whole explanation is spoken in 100 seconds at most; this scene in ${sceneSeconds(input.outline.plan.steps.length)} seconds at most, so about 3 beats of 12 words.`,
  ];
  if (input.extra) lines.push(input.extra);
  return { system, messages: [{ role: "user", content: lines.join("\n") }] };
}
