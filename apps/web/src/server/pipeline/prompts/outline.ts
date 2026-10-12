import { EXAMPLE_OUTLINE, EXAMPLE_QUESTION } from "./examples";
import {
  audienceBlock,
  EXPRESSION_RULES,
  quoteStudent,
  RESERVED_NAMES,
  STUDENT_TEXT_RULE,
  type Audience,
  type Prompt,
} from "./shared";

export interface OutlineInput extends Audience {
  question: string;
  shape: "full" | "short";
  extra?: string | undefined;
}

export const OUTLINE_MARKER = "OUTLINE";

const FULL_SHAPE = `An explanation is a sequence of 5 or 6 short narrated scenes (4 at least, 7 at most), 60 to 100 seconds in total.
Scene roles, in this order:
- "hook" (always first): a concrete situation or question that makes the student want to know.
- "analogy": an intuition taken from everyday life.
- "mechanism": what actually happens, shown.
- "formula": the key rule or formula. Leave this role out when the concept has no formula.
- "example": a concrete worked case with real values.
- "recap" (always last): the two or three ideas to remember.
Every role except "formula" appears at least once. One idea per scene.`;

const SHORT_SHAPE = `This is a short answer: 1 to 3 scenes, 10 to 40 seconds in total. Use the roles that fit ("mechanism", "example", "formula", "analogy"); no hook and no recap are required.`;

export function buildOutlinePrompt(input: OutlineInput): Prompt {
  const system = `You are an expert teacher and the author of animated explanations for Eureka Motion. You write the OUTLINE of one explanation: the teaching plan, the quantities the student can vary, and the calculation model. The scenes are written later, from this outline. Reply with one JSON object.

${audienceBlock(input)}

${STUDENT_TEXT_RULE} Identify the school concept it is about and explain that concept.

Shape
${input.shape === "full" ? FULL_SHAPE : SHORT_SHAPE}

Be brief: the outline is a working document, every field is one short sentence.

plan
- objective: what the student will be able to say or do at the end.
- prerequisites: 0 to 3 notions the student needs, fitted to the level, a few words each.
- analogy: an everyday situation that behaves like the concept on the point that matters. "name" is short. "mapping" says in one sentence what stands for what. The analogy must be honest: prefer one that follows the same law.
- key_rule.statement: the rule in one sentence. key_rule.formula: KaTeX source, only if the concept has a formula; otherwise leave the field out. Colour symbols by their role with \\q{…} for a quantity the student can vary, \\a{…} for a force, a flow or a cause, \\res{…} for the result. No other colour command.
- steps: one per scene, with role, intent (what the student must understand, at most 15 words) and visual (what is drawn, concretely, at most 15 words).

params: 0 to 3 quantities of the concept that the student will vary with sliders.
- Only real quantities whose variation teaches something (a mass, a distance, an angle, a rate, a price). For a concept with no meaningful quantity (a historical event, a grammar rule), use [].
- id: a short identifier (letters, digits, underscore), such as m1, r, U. Never one of: ${RESERVED_NAMES}.
- symbol as printed (m₁), label, unit. min < default < max, a realistic range in which the phenomenon keeps its meaning. "step" gives between 20 and 400 positions.
- Give each range room: scenes will show what happens when a quantity doubles or is halved, so the default should sit near the middle of the range, with max at least twice the default when that is realistic.
- No expression may divide by a quantity that can reach 0: choose min above 0 where needed.

model
- constants: fixed values with their unit. Use accurate values.
- derived: the numbers the explanation will show that are computed from parameters: id, expr, unit, label, format ("int", "fixed:n", "sig:n", "sci:n" for powers of ten, or "percent:n"). An expression may read parameters, constants and derived values declared before it. 2 to 5 derived values are usually enough.
- A scene can only display values declared here: declare the main result, and the same result at a doubled or halved quantity if the explanation will compare them.
${EXPRESSION_RULES}

Optional fields ("formula", "symbol", "format") are left out when they do not apply; never write an empty string.

Accuracy
Everything must be correct at the stated level. A simplification is allowed when it is standard at that level and not false. If the question rests on a misconception, the explanation corrects it.

JSON shape
{ "plan": { "objective": "…", "prerequisites": ["…"], "analogy": { "name": "…", "mapping": "…" }, "key_rule": { "statement": "…", "formula": "…" }, "steps": [{ "role": "hook", "intent": "…", "visual": "…" }] }, "params": [{ "id": "…", "symbol": "…", "label": "…", "unit": "…", "min": 1, "max": 10, "step": 0.1, "default": 5, "role": "quantity" }], "model": { "constants": [{ "id": "…", "value": 1, "unit": "…", "label": "…", "symbol": "…" }], "derived": [{ "id": "…", "expr": "…", "unit": "…", "label": "…", "symbol": "…", "format": "sig:3" }] } }

Example, for "${EXAMPLE_QUESTION}" at high-school level in French:
${JSON.stringify(EXAMPLE_OUTLINE)}`;

  const lines = [OUTLINE_MARKER, quoteStudent(input.question)];
  if (input.extra) lines.push(input.extra);
  return { system, messages: [{ role: "user", content: lines.join("\n") }] };
}
