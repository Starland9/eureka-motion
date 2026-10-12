import type { Outline, Scene } from "scene";
import { LANGUAGE_NAME, LEVEL_GUIDE, type Audience, type Prompt } from "./shared";

export interface CheckerInput extends Audience {
  outline: Outline;
  scene: Scene;
}

export function buildCheckerPrompt(input: CheckerInput): Prompt {
  const system = `You check one scene of an animated explanation against its outline, which an expert has already validated. Reply with one JSON object.

Audience of the explanation: ${LEVEL_GUIDE[input.level]}

How to read a scene
- A scene is a JSON description: elements placed in slots, and beats. Each beat is one narrated sentence with the actions that happen while it is said.
- { "expr": … } values and {{id}} references are computed live from the model of the outline, so they are always numerically right.
- A "sweep" action moves one parameter while the sentence is spoken: from its current value to "to", then back to where it started (it stays there only with "hold": true). "to" is evaluated from the current values, so { "expr": "2 * r" } doubles r exactly, whatever r was. Every bound value and every readout follows the parameter during the sweep.
- A "play" action runs a simulation forward in time. "show", "highlight" and "focus" only direct the eye.

What to check
You look for statements that are false. A scene is "invalid" only if:
- a narrated sentence states something scientifically wrong or contradicts the key rule of the outline; or
- the narration announces an effect that the scene does the opposite of, or cannot show (for instance it says "at triple the distance" while the sweep goes elsewhere or is cut short by the range of the parameter); or
- a text or a binding displays a value under a wrong name; or
- the narration is not in ${LANGUAGE_NAME[input.language]}.

Everything else is "valid". In particular, do not reject a scene because you would have drawn it differently, added an element, chosen another layout or another example, or because it simplifies in a way that is standard at this level. When in doubt, the scene is valid.

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
