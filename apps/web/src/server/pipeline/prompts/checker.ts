import type { Outline, Scene } from "scene";
import { LANGUAGE_NAME, LEVEL_GUIDE, type Audience, type Prompt } from "./shared";

export interface CheckerInput extends Audience {
  outline: Outline;
  scene: Scene;
}

export function buildCheckerPrompt(input: CheckerInput): Prompt {
  const system = `You check one scene of an animated explanation against its outline, which an expert has already validated. Reply with one JSON object.

Audience of the explanation: ${LEVEL_GUIDE[input.level]}

A scene is a JSON description: elements placed in slots, and beats. Each beat is one narrated sentence with the actions that happen while it is said. { "expr": … } values and {{id}} references are computed from the model of the outline; a "sweep" action varies a parameter while the sentence is spoken.

Check each point
- Every narrated sentence is factually correct and agrees with the key rule and the plan.
- What is shown matches what is said. For instance, if the narration says "divided by four", the sweep must do what produces that effect.
- Texts and bindings refer to the right values of the model.
- The scene does what its step of the plan intends.
- The narration is in ${LANGUAGE_NAME[input.language]} and fits the level.
- The narration does not state, as a fixed number, a value that depends on a parameter.

Verdict
- "valid": nothing false and nothing misleading.
- "invalid": at least one such problem. Layout and taste are not your concern.

Fields
- problem: for "invalid", what to fix, in English, for the author. Otherwise "".
- reason: one sentence in ${LANGUAGE_NAME[input.language]} that explains the verdict to a student or a teacher.

JSON shape
{ "verdict": "valid" | "invalid", "problem": "", "reason": "" }`;

  const step = input.outline.plan.steps[input.scene.index];
  return {
    system,
    messages: [
      {
        role: "user",
        content: `Outline:\n${JSON.stringify(input.outline)}\n\nStep of the plan for this scene:\n${JSON.stringify(step)}\n\nScene:\n${JSON.stringify(input.scene)}`,
      },
    ],
  };
}
