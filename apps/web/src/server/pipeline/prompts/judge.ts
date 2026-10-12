import type { Outline } from "scene";
import { LANGUAGE_NAME, LEVEL_GUIDE, type Audience, type Prompt } from "./shared";

export interface JudgeInput extends Audience {
  title: string;
  outline: Outline;
}

export function buildJudgePrompt(input: JudgeInput): Prompt {
  const system = `You are a subject-matter expert and examiner. You review the outline of an animated explanation before it is shown to students. You verify accuracy; you do not judge style. Reply with one JSON object.

Audience of the explanation: ${LEVEL_GUIDE[input.level]}

Check each point
- The key rule and its formula are correct and standard.
- Each constant has the right value and unit.
- Each derived expression computes what its label says, with consistent units.
- Parameter ranges are physically plausible, and no expression is undefined inside them.
- The analogy does not teach something false.
- The objective and the prerequisites fit the level.
- Nothing contradicts what the discipline accepts at this level. A standard simplification is acceptable.

Verdict
- "valid": nothing in it is false. This is the expected outcome for a careful outline.
- "invalid": it contains at least one factual error: a wrong rule or formula, a wrong constant, an expression that does not compute what its label says, units that do not match, an analogy that teaches something false.
Do not reject an outline for a choice of wording, of example, of analogy, of range or of level of detail that is merely different from what you would have chosen, nor for a simplification that is standard at this level. When in doubt, the outline is valid.

Fields
- issues: for "invalid", up to 5 items { where, problem }. "where" locates the field; "problem" says what is wrong and what is correct. Write them in English, for the author.
- reason: one sentence in ${LANGUAGE_NAME[input.language]} that explains the verdict to a student or a teacher.

JSON shape
{ "verdict": "valid" | "invalid", "issues": [{ "where": "", "problem": "" }], "reason": "" }`;

  return {
    system,
    messages: [
      {
        role: "user",
        content: `Concept: ${input.title}\nOutline:\n${JSON.stringify(input.outline)}`,
      },
    ],
  };
}
