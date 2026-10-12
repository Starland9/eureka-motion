import {
  CONSTANTS,
  ExprError,
  identifiers,
  parse,
  TIME_IDENTIFIER,
  type FunctionName,
  type Node,
} from "./parse";

export type Scope = Readonly<Record<string, number>>;

const IMPLEMENTATIONS: Record<FunctionName, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
};

export function evaluate(node: Node, scope: Scope): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var": {
      if (Object.hasOwn(scope, node.name)) return scope[node.name] as number;
      if (Object.hasOwn(CONSTANTS, node.name)) return CONSTANTS[node.name] as number;
      throw new ExprError(`Unknown name "${node.name}"`, 0);
    }
    case "neg":
      return -evaluate(node.arg, scope);
    case "bin": {
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "^":
          return left ** right;
      }
      throw new ExprError("Unknown operator", 0);
    }
    case "call":
      return IMPLEMENTATIONS[node.fn](...node.args.map((arg) => evaluate(arg, scope)));
  }
}

export interface Compiled {
  source: string;
  ast: Node;
  deps: readonly string[];
  usesTime: boolean;
  evaluate(scope: Scope): number;
}

const cache = new Map<string, Compiled>();
const CACHE_LIMIT = 2000;

export function compile(source: string): Compiled {
  const hit = cache.get(source);
  if (hit) return hit;
  const ast = parse(source);
  const deps = [...identifiers(ast)];
  const compiled: Compiled = {
    source,
    ast,
    deps,
    usesTime: deps.includes(TIME_IDENTIFIER),
    evaluate: (scope) => evaluate(ast, scope),
  };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, compiled);
  return compiled;
}

export interface CheckOptions {
  allowed: ReadonlySet<string>;
  allowTime?: boolean;
}

export function checkExpression(source: string, options: CheckOptions): string[] {
  let compiled: Compiled;
  try {
    compiled = compile(source);
  } catch (error) {
    return [`"${source}": ${(error as Error).message}`];
  }
  const problems: string[] = [];
  for (const name of compiled.deps) {
    if (name === TIME_IDENTIFIER) {
      if (!options.allowTime) {
        problems.push(`"${source}": time "t" is not allowed in this property`);
      }
      continue;
    }
    if (!options.allowed.has(name)) {
      problems.push(`"${source}": unknown name "${name}"`);
    }
  }
  return problems;
}

export type Bindable = number | { expr: string };

export function isBound(value: unknown): value is { expr: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { expr?: unknown }).expr === "string"
  );
}

export function resolve(value: Bindable, scope: Scope): number {
  return typeof value === "number" ? value : compile(value.expr).evaluate(scope);
}
