import { checkExpression, compile, type Scope } from "./evaluate";
import { CONSTANTS, TIME_IDENTIFIER, FUNCTIONS } from "./parse";

export interface ModelParam {
  id: string;
  min: number;
  max: number;
  default: number;
}

export interface ModelConstant {
  id: string;
  value: number;
}

export interface ModelDerived {
  id: string;
  expr: string;
}

export interface ModelDefinition {
  params: readonly ModelParam[];
  constants: readonly ModelConstant[];
  derived: readonly ModelDerived[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set<string>([
  TIME_IDENTIFIER,
  ...Object.keys(FUNCTIONS),
  ...Object.keys(CONSTANTS),
]);

export function isValidIdentifier(id: string): boolean {
  return IDENTIFIER.test(id);
}

export function isReservedIdentifier(id: string): boolean {
  return RESERVED.has(id);
}

export function defaultParamValues(params: readonly ModelParam[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const param of params) values[param.id] = param.default;
  return values;
}

export function buildScope(
  model: ModelDefinition,
  paramValues: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const constant of model.constants) scope[constant.id] = constant.value;
  for (const param of model.params) {
    const raw = paramValues[param.id];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : param.default;
    scope[param.id] = Math.min(Math.max(value, param.min), param.max);
  }
  for (const derived of model.derived) {
    scope[derived.id] = compile(derived.expr).evaluate(scope);
  }
  return scope;
}

export function modelIdentifiers(model: ModelDefinition): Set<string> {
  return new Set([
    ...model.constants.map((c) => c.id),
    ...model.params.map((p) => p.id),
    ...model.derived.map((d) => d.id),
  ]);
}

export function checkModel(model: ModelDefinition): string[] {
  const problems: string[] = [];
  const declared = new Set<string>();

  const declare = (kind: string, id: string): void => {
    if (!isValidIdentifier(id)) {
      problems.push(`${kind} "${id}": not a valid identifier (letters, digits, underscore)`);
    } else if (isReservedIdentifier(id)) {
      problems.push(`${kind} "${id}": this name is reserved`);
    } else if (declared.has(id)) {
      problems.push(`${kind} "${id}": declared more than once`);
    }
    declared.add(id);
  };

  for (const constant of model.constants) {
    declare("constant", constant.id);
    if (!Number.isFinite(constant.value)) {
      problems.push(`constant "${constant.id}": value must be a finite number`);
    }
  }
  for (const param of model.params) {
    declare("parameter", param.id);
    if (!(param.min < param.max)) {
      problems.push(`parameter "${param.id}": min must be lower than max`);
    } else if (param.default < param.min || param.default > param.max) {
      problems.push(`parameter "${param.id}": default must lie between min and max`);
    }
  }

  let expressionsOk = true;
  for (const derived of model.derived) {
    const found = checkExpression(derived.expr, { allowed: declared, allowTime: false });
    if (found.length > 0) {
      expressionsOk = false;
      problems.push(...found.map((p) => `derived "${derived.id}": ${p}`));
    }
    declare("derived", derived.id);
  }
  if (problems.length > 0 || !expressionsOk) return problems;

  const samples: Record<string, number>[] = [defaultParamValues(model.params)];
  for (const param of model.params) {
    samples.push({ ...defaultParamValues(model.params), [param.id]: param.min });
    samples.push({ ...defaultParamValues(model.params), [param.id]: param.max });
  }
  const reported = new Set<string>();
  for (const sample of samples) {
    const scope: Scope = buildScope(model, sample);
    for (const derived of model.derived) {
      if (!Number.isFinite(scope[derived.id]) && !reported.has(derived.id)) {
        reported.add(derived.id);
        const at = model.params.map((p) => `${p.id}=${sample[p.id]}`).join(", ");
        problems.push(
          `derived "${derived.id}": "${derived.expr}" is not a finite number when ${at || "evaluated"}`,
        );
      }
    }
  }
  return problems;
}
