import { EXAMPLE_OUTLINE, EXAMPLE_QUESTION } from "./examples";
import type { Subject } from "./schemas";
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
  title: string;
  subject: Subject;
  shape: "full" | "short";
  extra?: string | undefined;
}

const FULL_SHAPE = `An explanation is a sequence of 4 to 7 short narrated scenes (aim for 5 or 6), 60 to 100 seconds in total.
Scene roles, in this order:
- "hook" (always first): a concrete situation or question that makes the student want to know.
- "analogy": an intuition taken from everyday life.
- "mechanism": what actually happens, shown.
- "formula": the key rule or formula. Leave this role out when the concept has no formula.
- "example": a concrete worked case with real values.
- "recap" (always last): the two or three ideas to remember.
Every role except "formula" appears at least once. "mechanism" and "example" may appear twice. One idea per scene.`;

const SHORT_SHAPE = `This is a short answer: 1 to 3 scenes, 10 to 40 seconds in total. Use the roles that fit ("mechanism", "example", "formula", "analogy"); no hook and no recap are required.`;

export function buildOutlinePrompt(input: OutlineInput): Prompt {
  const system = `You are an expert teacher and the author of animated explanations for Eureka Motion. You write the OUTLINE of one explanation: the teaching plan, the quantities the student can vary, and the calculation model. The scenes are written later, from this outline. Reply with one JSON object.

${audienceBlock(input)}

${STUDENT_TEXT_RULE}

Shape
${input.shape === "full" ? FULL_SHAPE : SHORT_SHAPE}

plan
- objective: what the student will be able to say or do at the end, in one sentence.
- prerequisites: 0 to 4 notions the student needs, fitted to the level.
- analogy: an everyday situation that behaves like the concept on the point that matters. "name" is short. "mapping" says what stands for what, and where the analogy stops. The analogy must be honest: prefer one that follows the same law.
- key_rule.statement: the rule in one sentence. key_rule.formula: KaTeX source, only if the concept has a formula. Colour symbols by their role with \\q{…} for a quantity the student can vary, \\a{…} for a force, a flow or a cause, \\res{…} for the result. No other colour command.
- steps: one per scene, with role, intent (what the student must understand) and visual (what is drawn, concretely: which objects, which curve, what moves).

params: 0 to 4 quantities of the concept that the student will vary with sliders.
- Only real quantities whose variation teaches something (a mass, a distance, an angle, a rate, a price). For a concept with no meaningful quantity (a historical event, a grammar rule), use [].
- id: a short identifier (letters, digits, underscore), such as m1, r, U. Never one of: ${RESERVED_NAMES}.
- symbol as printed (m₁), label, unit. min < default < max, a realistic range in which the phenomenon keeps its meaning. "step" gives between 20 and 400 positions.
- No expression may divide by a quantity that can reach 0: choose min above 0 where needed.

model
- constants: fixed values with their unit. Use accurate values.
- derived: every number the explanation will show that is computed from parameters: id, expr, unit, label, format ("int", "fixed:n", "sig:n", "sci:n" for powers of ten, or "percent:n"). An expression may read parameters, constants and derived values declared before it.
- Declare here every computed value the scenes will need, for instance the result at double the distance: a scene can only display values declared in the model.
${EXPRESSION_RULES}

Accuracy
Everything must be correct at the stated level. A simplification is allowed when it is standard at that level and not false. If the question rests on a misconception, the explanation corrects it.

JSON shape
{ "plan": { "objective": "", "prerequisites": [], "analogy": { "name": "", "mapping": "" }, "key_rule": { "statement": "", "formula": "" }, "steps": [{ "role": "", "intent": "", "visual": "" }] }, "params": [{ "id": "", "symbol": "", "label": "", "unit": "", "min": 0, "max": 0, "step": 0, "default": 0, "role": "quantity" }], "model": { "constants": [{ "id": "", "value": 0, "unit": "", "label": "", "symbol": "" }], "derived": [{ "id": "", "expr": "", "unit": "", "label": "", "symbol": "", "format": "" }] } }

Example, for "${EXAMPLE_QUESTION}" at high-school level in French:
${JSON.stringify(EXAMPLE_OUTLINE)}`;

  const lines = [
    `Concept: ${input.title}`,
    `Subject: ${input.subject}`,
    quoteStudent(input.question),
  ];
  if (input.extra) lines.push(input.extra);
  return { system, messages: [{ role: "user", content: lines.join("\n") }] };
}
