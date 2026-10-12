import { describe, expect, it } from "vitest";
import {
  buildScope,
  checkExpression,
  checkModel,
  compile,
  evaluate,
  ExprError,
  FormatError,
  formatNumber,
  FUNCTIONS,
  identifiers,
  interpolate,
  isBound,
  MAX_EXPRESSION_LENGTH,
  parse,
  parseFormat,
  resolve,
  templateReferences,
  type ModelDefinition,
} from "../../src/expr";

const calc = (source: string, scope: Record<string, number> = {}): number =>
  evaluate(parse(source), scope);

describe("parse and evaluate: operators", () => {
  it.each([
    ["1 + 2", 3],
    ["7 - 10", -3],
    ["3 * 4", 12],
    ["9 / 4", 2.25],
    ["2 ^ 10", 1024],
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["8 - 3 - 2", 3],
    ["16 / 4 / 2", 2],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["(-2) ^ 2", 4],
    ["2 ^ -1", 0.5],
    ["--3", 3],
    ["+5", 5],
    ["2 * -3", -6],
    ["1e3 + 1", 1001],
    ["6.674e-11 * 1e11", 6.674],
    [".5 + .5", 1],
    ["1.5E2", 150],
  ])("%s = %s", (source, expected) => {
    expect(calc(source)).toBeCloseTo(expected, 10);
  });

  it("reads names from the scope", () => {
    expect(calc("G * m1 * m2 / r^2", { G: 2, m1: 3, m2: 4, r: 2 })).toBe(6);
    expect(calc("r_view + _x1", { r_view: 1, _x1: 2 })).toBe(3);
  });

  it("returns non-finite values instead of throwing on undefined arithmetic", () => {
    expect(calc("1 / 0")).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(calc("sqrt(-1)"))).toBe(true);
  });
});

describe("parse and evaluate: functions and constants", () => {
  it.each([
    ["sqrt(16)", 4],
    ["abs(-3.5)", 3.5],
    ["sin(0)", 0],
    ["cos(0)", 1],
    ["tan(0)", 0],
    ["asin(1)", Math.PI / 2],
    ["acos(1)", 0],
    ["atan(1)", Math.PI / 4],
    ["atan2(1, 1)", Math.PI / 4],
    ["exp(0)", 1],
    ["ln(e)", 1],
    ["log10(1000)", 3],
    ["min(3, 1, 2)", 1],
    ["max(3, 1, 2)", 3],
    ["round(2.5)", 3],
    ["floor(2.9)", 2],
    ["ceil(2.1)", 3],
    ["clamp(5, 0, 3)", 3],
    ["clamp(-1, 0, 3)", 0],
    ["clamp(2, 0, 3)", 2],
    ["pi", Math.PI],
    ["2 * pi", 2 * Math.PI],
    ["sqrt(3^2 + 4^2)", 5],
    ["max(1, min(5, 2)) + abs(-1)", 3],
  ])("%s", (source, expected) => {
    expect(calc(source)).toBeCloseTo(expected, 10);
  });

  it("has a test for every allowed function", () => {
    const covered = new Set([
      "sqrt",
      "abs",
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "exp",
      "ln",
      "log10",
      "min",
      "max",
      "round",
      "floor",
      "ceil",
      "clamp",
    ]);
    expect(new Set(Object.keys(FUNCTIONS))).toEqual(covered);
  });
});

describe("parse: everything outside the grammar is rejected", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["1 +", "end of expression"],
    ["* 2", "Unexpected"],
    ["(1 + 2", "Expected"],
    ["1 + 2)", "Unexpected"],
    ["2 3", "Unexpected number"],
    ["2 x", "Unexpected name"],
    ["2x", "Unexpected name"],
    ["x y", "Unexpected name"],
    ["a = 1", "Unexpected character"],
    ["a == 1", "Unexpected character"],
    ["a > 1", "Unexpected character"],
    ["a ? 1 : 2", "Unexpected character"],
    ["a.b", "Unexpected"],
    ["a[0]", "Unexpected character"],
    ["'text'", "Unexpected character"],
    ['"text"', "Unexpected character"],
    ["`x`", "Unexpected character"],
    ["a; b", "Unexpected character"],
    ["a && b", "Unexpected character"],
    ["a % 2", "Unexpected character"],
    ["!a", "Unexpected character"],
    ["{a}", "Unexpected character"],
    ["1,2", "Unexpected"],
    ["m₁ + 1", "Unexpected character"],
    ["eval(1)", "Unknown function"],
    ["Function(1)", "Unknown function"],
    ["constructor(1)", "Unknown function"],
    ["toString(1)", "Unknown function"],
    ["hasOwnProperty(1)", "Unknown function"],
    ["__proto__(1)", "Unknown function"],
    ["random()", "Unknown function"],
    ["sqrt()", "takes 1 argument"],
    ["sqrt(1, 2)", "takes 1 argument"],
    ["atan2(1)", "takes 2 argument"],
    ["clamp(1, 2)", "takes 3 argument"],
    ["min(1)", "takes 2 to 8 argument"],
    ["sqrt(1,)", "Unexpected"],
    ["sqrt 4", "Unexpected number"],
    ["1e999", "out of range"],
  ])("rejects %j", (source, fragment) => {
    expect(() => parse(source)).toThrow(ExprError);
    expect(() => parse(source)).toThrow(fragment);
  });

  it("rejects expressions that are too long or too deeply nested", () => {
    expect(() => parse("1+".repeat(MAX_EXPRESSION_LENGTH) + "1")).toThrow("longer than");
    expect(() => parse(`${"(".repeat(40)}1${")".repeat(40)}`)).toThrow("nested too deeply");
    expect(() => parse(`${"-".repeat(40)}1`)).toThrow("nested too deeply");
  });

  it("rejects a non-string input", () => {
    expect(() => parse(42 as unknown as string)).toThrow(ExprError);
  });

  it("reports the position of the problem", () => {
    try {
      parse("1 + $");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ExprError);
      expect((error as ExprError).position).toBe(4);
    }
  });
});

describe("evaluate: names", () => {
  it("throws on a name missing from the scope", () => {
    expect(() => calc("a + 1")).toThrow('Unknown name "a"');
  });

  it("never reads inherited properties of the scope object", () => {
    expect(() => calc("constructor")).toThrow("Unknown name");
    expect(() => calc("toString")).toThrow("Unknown name");
    expect(() => calc("__proto__")).toThrow("Unknown name");
  });
});

describe("identifiers and compile", () => {
  it("lists the names an expression reads, without built-in constants", () => {
    expect([...identifiers(parse("G * m1 * m2 / r^2 + pi + sin(x)"))].sort()).toEqual([
      "G",
      "m1",
      "m2",
      "r",
      "x",
    ]);
  });

  it("compiles once and flags the use of time", () => {
    const a = compile("0.5 * g * t^2");
    expect(compile("0.5 * g * t^2")).toBe(a);
    expect(a.usesTime).toBe(true);
    expect(a.evaluate({ g: 10, t: 2 })).toBe(20);
    expect(compile("m * g").usesTime).toBe(false);
  });

  it("resolves literal and bound values", () => {
    expect(resolve(3, {})).toBe(3);
    expect(resolve({ expr: "2 * r" }, { r: 4 })).toBe(8);
    expect(isBound({ expr: "r" })).toBe(true);
    expect(isBound(3)).toBe(false);
    expect(isBound(null)).toBe(false);
    expect(isBound({ expr: 3 })).toBe(false);
  });
});

describe("checkExpression", () => {
  const allowed = new Set(["m1", "m2", "r", "G"]);

  it("accepts an expression that reads only declared names", () => {
    expect(checkExpression("G * m1 * m2 / r^2", { allowed })).toEqual([]);
  });

  it("reports unknown names", () => {
    expect(checkExpression("G * m3", { allowed })).toEqual(['"G * m3": unknown name "m3"']);
  });

  it("allows time only in temporal properties", () => {
    expect(checkExpression("r * t", { allowed })[0]).toContain('time "t" is not allowed');
    expect(checkExpression("r * t", { allowed, allowTime: true })).toEqual([]);
  });

  it("reports a syntax error as a problem instead of throwing", () => {
    expect(checkExpression("G * (", { allowed })[0]).toContain("end of expression");
  });
});

describe("number formats", () => {
  it("parses the five formats", () => {
    expect(parseFormat("int")).toEqual({ kind: "int" });
    expect(parseFormat("fixed:2")).toEqual({ kind: "fixed", digits: 2 });
    expect(parseFormat("sig:3")).toEqual({ kind: "sig", digits: 3 });
    expect(parseFormat("sci:2")).toEqual({ kind: "sci", digits: 2 });
    expect(parseFormat("percent:1")).toEqual({ kind: "percent", digits: 1 });
  });

  it.each(["", "money", "fixed", "sig", "int:2", "fixed:-1", "fixed:99", "sig:0", "FIXED:2"])(
    "rejects the format %j",
    (spec) => {
      expect(() => parseFormat(spec)).toThrow(FormatError);
    },
  );

  it("uses a decimal comma in French and a point in English", () => {
    expect(formatNumber(1.984, { kind: "fixed", digits: 2 }, "fr")).toBe("1,98");
    expect(formatNumber(1.984, { kind: "fixed", digits: 2 }, "en")).toBe("1.98");
  });

  it("formats integers with the thousands separator of the language", () => {
    expect(formatNumber(1234.6, { kind: "int" }, "en")).toBe("1,235");
    expect(formatNumber(1234.6, { kind: "int" }, "fr")).toBe("1 235");
    expect(formatNumber(-3, { kind: "int" }, "en")).toBe("−3");
  });

  it("formats significant digits", () => {
    expect(formatNumber(9.80665, { kind: "sig", digits: 3 }, "fr")).toBe("9,81");
    expect(formatNumber(1234.5, { kind: "sig", digits: 3 }, "en")).toBe("1,230");
    expect(formatNumber(0.001234, { kind: "sig", digits: 3 }, "en")).toBe("0.00123");
    expect(formatNumber(12, { kind: "sig", digits: 3 }, "en")).toBe("12");
    expect(formatNumber(0, { kind: "sig", digits: 3 }, "en")).toBe("0");
  });

  it("switches to powers of ten when significant digits would be unreadable", () => {
    expect(formatNumber(1.98e20, { kind: "sig", digits: 3 }, "fr")).toBe("1,98 × 10²⁰");
    expect(formatNumber(6.674e-11, { kind: "sig", digits: 4 }, "en")).toBe("6.674 × 10⁻¹¹");
  });

  it("formats scientific notation", () => {
    expect(formatNumber(1.98e20, { kind: "sci", digits: 2 }, "fr")).toBe("1,98 × 10²⁰");
    expect(formatNumber(5.97e24, { kind: "sci", digits: 2 }, "en")).toBe("5.97 × 10²⁴");
    expect(formatNumber(-4.2e-3, { kind: "sci", digits: 1 }, "en")).toBe("−4.2 × 10⁻³");
    expect(formatNumber(9.999e5, { kind: "sci", digits: 2 }, "en")).toBe("1.00 × 10⁶");
    expect(formatNumber(3.14, { kind: "sci", digits: 2 }, "en")).toBe("3.14");
    expect(formatNumber(0, { kind: "sci", digits: 2 }, "en")).toBe("0.00");
  });

  it("formats percentages", () => {
    expect(formatNumber(0.256, { kind: "percent", digits: 1 }, "en")).toBe("25.6%");
    expect(formatNumber(0.256, { kind: "percent", digits: 1 }, "fr")).toBe("25,6 %");
  });

  it("shows a dash for a value that is not finite", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("defaults to three significant digits in French", () => {
    expect(formatNumber(3.14159)).toBe("3,14");
  });
});

describe("text interpolation", () => {
  const scope = { F: 1.98e20, r: 3.84e8, ratio: 0.25 };

  it("replaces references with formatted values", () => {
    expect(interpolate("La force vaut {{F|sci:2}} N.", scope, { language: "fr" })).toBe(
      "La force vaut 1,98 × 10²⁰ N.",
    );
    expect(interpolate("{{ ratio | percent:0 }}", scope, { language: "en" })).toBe("25%");
  });

  it("uses the declared format of a value when the text gives none", () => {
    expect(
      interpolate("F = {{F}}", scope, {
        language: "en",
        formats: { F: { kind: "sci", digits: 1 } },
      }),
    ).toBe("F = 2.0 × 10²⁰");
    expect(interpolate("r = {{r}}", scope, { language: "en" })).toBe("r = 3.84 × 10⁸");
  });

  it("leaves a text without references untouched", () => {
    expect(interpolate("Deux masses s'attirent.", scope, { language: "fr" })).toBe(
      "Deux masses s'attirent.",
    );
  });

  it("throws on an unknown value", () => {
    expect(() => interpolate("{{m3}}", scope, { language: "fr" })).toThrow('Unknown value "m3"');
  });

  it("lists references for validation and rejects malformed ones", () => {
    expect(templateReferences("{{F|sci:2}} et {{r}}").map((r) => r.id)).toEqual(["F", "r"]);
    expect(templateReferences("aucune")).toEqual([]);
    expect(() => templateReferences("{{F * 2}}")).toThrow("Malformed interpolation");
    expect(() => templateReferences("{{F|money}}")).toThrow();
    expect(() => templateReferences("{{}}")).toThrow("Malformed interpolation");
  });
});

describe("calculation model", () => {
  const gravity: ModelDefinition = {
    constants: [{ id: "G", value: 6.674e-11 }],
    params: [
      { id: "m1", min: 1e24, max: 1e25, default: 5.97e24 },
      { id: "m2", min: 1e22, max: 1e23, default: 7.35e22 },
      { id: "r", min: 1e8, max: 8e8, default: 3.84e8 },
    ],
    derived: [
      { id: "F", expr: "G * m1 * m2 / r^2" },
      { id: "F_half", expr: "F / 2" },
    ],
  };

  it("builds the scope from defaults, in declaration order", () => {
    const scope = buildScope(gravity);
    expect(scope.F).toBeCloseTo(1.985e20, -18);
    expect(scope.F_half).toBeCloseTo((scope.F as number) / 2, 5);
  });

  it("recomputes derived values when a parameter changes", () => {
    const base = buildScope(gravity).F as number;
    const doubled = buildScope(gravity, { r: 2 * 3.84e8 }).F as number;
    expect(doubled / base).toBeCloseTo(0.25, 10);
  });

  it("clamps parameter values to their range and ignores junk", () => {
    expect(buildScope(gravity, { r: 1 }).r).toBe(1e8);
    expect(buildScope(gravity, { r: 1e99 }).r).toBe(8e8);
    expect(buildScope(gravity, { r: Number.NaN }).r).toBe(3.84e8);
  });

  it("accepts a sound model", () => {
    expect(checkModel(gravity)).toEqual([]);
  });

  it("rejects invalid, reserved and duplicate identifiers", () => {
    const problems = checkModel({
      constants: [
        { id: "pi", value: 3 },
        { id: "m₁", value: 1 },
      ],
      params: [
        { id: "t", min: 0, max: 1, default: 0 },
        { id: "sin", min: 0, max: 1, default: 0 },
        { id: "a", min: 0, max: 1, default: 0 },
        { id: "a", min: 0, max: 1, default: 0 },
      ],
      derived: [],
    });
    expect(problems).toContain('constant "pi": this name is reserved');
    expect(problems.some((p) => p.includes('"m₁": not a valid identifier'))).toBe(true);
    expect(problems).toContain('parameter "t": this name is reserved');
    expect(problems).toContain('parameter "sin": this name is reserved');
    expect(problems).toContain('parameter "a": declared more than once');
  });

  it("rejects inconsistent parameter ranges", () => {
    const problems = checkModel({
      constants: [],
      params: [
        { id: "a", min: 5, max: 5, default: 5 },
        { id: "b", min: 0, max: 1, default: 2 },
      ],
      derived: [],
    });
    expect(problems).toContain('parameter "a": min must be lower than max');
    expect(problems).toContain('parameter "b": default must lie between min and max');
  });

  it("rejects a derived value that reads an undeclared or later name", () => {
    const problems = checkModel({
      constants: [],
      params: [{ id: "a", min: 0, max: 1, default: 0.5 }],
      derived: [
        { id: "x", expr: "a * y" },
        { id: "y", expr: "a + 1" },
        { id: "z", expr: "z + 1" },
      ],
    });
    expect(
      problems.some((p) => p.startsWith('derived "x"') && p.includes('unknown name "y"')),
    ).toBe(true);
    expect(
      problems.some((p) => p.startsWith('derived "z"') && p.includes('unknown name "z"')),
    ).toBe(true);
  });

  it("rejects time in a derived value", () => {
    const problems = checkModel({
      constants: [],
      params: [{ id: "g", min: 1, max: 20, default: 9.81 }],
      derived: [{ id: "h", expr: "0.5 * g * t^2" }],
    });
    expect(problems[0]).toContain('time "t" is not allowed');
  });

  it("rejects a derived value that is not finite at a parameter bound", () => {
    const problems = checkModel({
      constants: [],
      params: [{ id: "r", min: 0, max: 10, default: 5 }],
      derived: [{ id: "F", expr: "1 / r^2" }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('derived "F"');
    expect(problems[0]).toContain("r=0");
  });
});
