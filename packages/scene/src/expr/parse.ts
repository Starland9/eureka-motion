export type Node =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: Node }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { type: "call"; fn: FunctionName; args: Node[] };

export const FUNCTIONS = {
  sqrt: [1, 1],
  abs: [1, 1],
  sin: [1, 1],
  cos: [1, 1],
  tan: [1, 1],
  asin: [1, 1],
  acos: [1, 1],
  atan: [1, 1],
  atan2: [2, 2],
  exp: [1, 1],
  ln: [1, 1],
  log10: [1, 1],
  min: [2, 8],
  max: [2, 8],
  round: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  clamp: [3, 3],
} as const satisfies Record<string, readonly [number, number]>;

export type FunctionName = keyof typeof FUNCTIONS;

export const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

export const TIME_IDENTIFIER = "t";

export const MAX_EXPRESSION_LENGTH = 200;
const MAX_DEPTH = 32;

export class ExprError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "ExprError";
    this.position = position;
  }
}

type Token =
  | { kind: "num"; value: number; pos: number }
  | { kind: "name"; value: string; pos: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "^" | "(" | ")" | ","; pos: number }
  | { kind: "end"; pos: number };

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPERATORS = new Set(["+", "-", "*", "/", "^", "(", ")", ","]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    const rest = source.slice(i);
    const num = NUMBER.exec(rest);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) {
        throw new ExprError(`Number out of range: ${num[0]}`, i);
      }
      tokens.push({ kind: "num", value, pos: i });
      i += num[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      tokens.push({ kind: "name", value: name[0], pos: i });
      i += name[0].length;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ kind: "op", value: ch as "+", pos: i });
      i += 1;
      continue;
    }
    throw new ExprError(`Unexpected character "${ch}"`, i);
  }
  tokens.push({ kind: "end", pos: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.expression();
    const token = this.peek();
    if (token.kind !== "end") {
      throw new ExprError(`Unexpected ${describe(token)}`, token.pos);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.index += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }

  private expect(value: string): void {
    const token = this.next();
    if (token.kind !== "op" || token.value !== value) {
      throw new ExprError(`Expected "${value}" but found ${describe(token)}`, token.pos);
    }
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      throw new ExprError("Expression is nested too deeply", this.peek().pos);
    }
  }

  private expression(): Node {
    this.enter();
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { value: "+" | "-" }).value;
      left = { type: "bin", op, left, right: this.term() };
    }
    this.depth -= 1;
    return left;
  }

  private term(): Node {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.next() as { value: "*" | "/" }).value;
      left = { type: "bin", op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp("-")) {
      this.next();
      this.enter();
      const arg = this.unary();
      this.depth -= 1;
      return { type: "neg", arg };
    }
    if (this.isOp("+")) {
      this.next();
      this.enter();
      const arg = this.unary();
      this.depth -= 1;
      return arg;
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (this.isOp("^")) {
      this.next();
      this.enter();
      const exponent = this.unary();
      this.depth -= 1;
      return { type: "bin", op: "^", left: base, right: exponent };
    }
    return base;
  }

  private primary(): Node {
    const token = this.next();
    if (token.kind === "num") {
      return { type: "num", value: token.value };
    }
    if (token.kind === "name") {
      if (this.isOp("(")) {
        return this.call(token.value, token.pos);
      }
      return { type: "var", name: token.value };
    }
    if (token.kind === "op" && token.value === "(") {
      const inner = this.expression();
      this.expect(")");
      return inner;
    }
    throw new ExprError(`Unexpected ${describe(token)}`, token.pos);
  }

  private call(name: string, pos: number): Node {
    if (!Object.hasOwn(FUNCTIONS, name)) {
      throw new ExprError(`Unknown function "${name}"`, pos);
    }
    const fn = name as FunctionName;
    this.expect("(");
    const args: Node[] = [];
    if (!this.isOp(")")) {
      args.push(this.expression());
      while (this.isOp(",")) {
        this.next();
        args.push(this.expression());
      }
    }
    this.expect(")");
    const [min, max] = FUNCTIONS[fn];
    if (args.length < min || args.length > max) {
      const expected = min === max ? `${min}` : `${min} to ${max}`;
      throw new ExprError(
        `Function "${fn}" takes ${expected} argument(s), got ${args.length}`,
        pos,
      );
    }
    return { type: "call", fn, args };
  }
}

function describe(token: Token): string {
  if (token.kind === "end") return "end of expression";
  if (token.kind === "num") return `number ${token.value}`;
  if (token.kind === "name") return `name "${token.value}"`;
  return `"${token.value}"`;
}

export function parse(source: string): Node {
  if (typeof source !== "string") {
    throw new ExprError("Expression must be a string", 0);
  }
  if (source.trim().length === 0) {
    throw new ExprError("Expression is empty", 0);
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ExprError(
      `Expression is longer than ${MAX_EXPRESSION_LENGTH} characters`,
      MAX_EXPRESSION_LENGTH,
    );
  }
  return new Parser(tokenize(source)).parse();
}

export function identifiers(node: Node, into: Set<string> = new Set()): Set<string> {
  switch (node.type) {
    case "num":
      break;
    case "var":
      if (!Object.hasOwn(CONSTANTS, node.name)) into.add(node.name);
      break;
    case "neg":
      identifiers(node.arg, into);
      break;
    case "bin":
      identifiers(node.left, into);
      identifiers(node.right, into);
      break;
    case "call":
      for (const arg of node.args) identifiers(arg, into);
      break;
  }
  return into;
}
