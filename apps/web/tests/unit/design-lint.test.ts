import { describe, expect, it } from "vitest";
import { lintText, type RuleId, type Violation } from "../../../../scripts/design-lint";

const COMPONENT = "apps/web/src/components/ui/probe.tsx";
const STYLESHEET = "apps/web/src/app/probe.css";

function lines(...rows: string[]): string {
  return rows.join("\n");
}

function rules(violations: Violation[]): RuleId[] {
  return violations.map((violation) => violation.rule);
}

describe("raw colours", () => {
  it("flags a hex colour in a string with its line and column", () => {
    const source = lines(
      "export function Probe() {",
      '  return <div style={{ color: "#ff0000" }} />;',
      "}",
    );
    expect(lintText(source, COMPONENT)).toEqual([
      { rule: "raw-color", line: 2, column: 32, text: "#ff0000" },
    ]);
  });

  it("flags short, long and alpha hex forms", () => {
    const source = lines('const a = "#fff";', 'const b = "#FBF8F1";', 'const c = "#16171a80";');
    expect(lintText(source, COMPONENT).map((violation) => violation.text)).toEqual([
      "#fff",
      "#FBF8F1",
      "#16171a80",
    ]);
  });

  it.each(["rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "oklab(", "color-mix("])(
    "flags %s in a string",
    (fn) => {
      const source = `const value = "${fn}0 0 0)";`;
      expect(rules(lintText(source, COMPONENT))).toEqual(["raw-color"]);
    },
  );

  it("flags a CSS colour function in a stylesheet", () => {
    const source = lines(".probe {", "  background: oklch(0.9 0.02 90);", "}");
    expect(lintText(source, STYLESHEET)).toMatchObject([
      { rule: "raw-color", line: 2, column: 15 },
    ]);
  });

  it("flags a named colour used as a value", () => {
    const source = lines(
      '<svg><rect fill="red" /></svg>;',
      'const style = { backgroundColor: "white" };',
      ".probe { border: 1px solid black; }",
    );
    expect(lintText(source, COMPONENT).map((violation) => violation.text)).toEqual([
      "red",
      "white",
      "black",
    ]);
  });

  it("flags a Tailwind palette colour", () => {
    const source = 'const cls = "flex bg-white text-red-500 border-black/40";';
    expect(lintText(source, COMPONENT).map((violation) => violation.text)).toEqual([
      "bg-white",
      "text-red-500",
      "border-black",
    ]);
  });

  it("accepts token classes, token variables and colour keywords", () => {
    const source = lines(
      'const cls = "bg-surface text-ink border-role-action bg-transparent";',
      'const style = { color: "var(--ink)", fill: "currentColor", stroke: "none" };',
      'const prose = "The result is drawn in ink over a yellow highlight.";',
    );
    expect(lintText(source, COMPONENT)).toEqual([]);
  });

  it("does not take a hash in a comment or an identifier for a colour", () => {
    const source = lines("// see #fff and #123456 in the spec", "const issue = `ticket #12`;");
    expect(lintText(source, COMPONENT)).toEqual([]);
  });

  it.each([
    ["the generated stylesheet", "apps/web/src/app/tokens.css", ":root { --ink: #16171a; }"],
    [
      "the global stylesheet",
      "apps/web/src/app/globals.css",
      "@utility bg-scrim { background-color: color-mix(in srgb, var(--ink) 40%, transparent); }",
    ],
    [
      "the scene tokens",
      "packages/scene/src/tokens/colors.ts",
      'export const ink = { paper: "#16171A", name: "red" };',
    ],
  ])("does not flag colour values in %s", (_name, file, source) => {
    expect(lintText(source, file)).toEqual([]);
  });

  it("limits the exceptions to the colour rule and to the files listed", () => {
    expect(
      rules(lintText('const a = "rounded-lg";', "packages/scene/src/tokens/colors.ts")),
    ).toEqual(["radius"]);
    expect(rules(lintText(":root { --ink: #16171a; }", "apps/web/src/app/other.css"))).toEqual([
      "raw-color",
    ]);
    expect(rules(lintText("a { border-radius: 8px; }", "apps/web/src/app/globals.css"))).toEqual([
      "radius",
    ]);
  });
});

describe("rounded corners", () => {
  it("flags rounded-lg with its line and column", () => {
    const source = lines(
      "export function Probe() {",
      '  return <div className="border rounded-lg p-4" />;',
      "}",
    );
    expect(lintText(source, COMPONENT)).toEqual([
      { rule: "radius", line: 2, column: 33, text: "rounded" },
    ]);
  });

  it("flags bare, prefixed and arbitrary radius classes", () => {
    const source = lines(
      'const a = "rounded";',
      'const b = cn("md:hover:rounded-t-xl");',
      "const c = `rounded-[3px] border`;",
    );
    expect(lintText(source, COMPONENT).map((violation) => violation.line)).toEqual([1, 2, 3]);
  });

  it("flags border-radius in CSS and in a style object", () => {
    expect(rules(lintText(".probe { border-radius: 8px; }", STYLESHEET))).toEqual(["radius"]);
    expect(rules(lintText(".probe { border-top-left-radius: 50%; }", STYLESHEET))).toEqual([
      "radius",
    ]);
    expect(rules(lintText("const style = { borderRadius: 4 };", COMPONENT))).toEqual(["radius"]);
    expect(rules(lintText('const style = { borderRadius: "999px" };', COMPONENT))).toEqual([
      "radius",
    ]);
  });

  it("accepts a reset to zero and a variable named rounded", () => {
    const source = lines(
      "const rounded = Number(value.toPrecision(3));",
      "const style = { borderRadius: 0 };",
    );
    expect(lintText(source, COMPONENT)).toEqual([]);
    expect(lintText("* { border-radius: 0; }", STYLESHEET)).toEqual([]);
    expect(lintText("* { border-radius: 0px !important; }", STYLESHEET)).toEqual([]);
  });
});

describe("shadows", () => {
  it("flags shadow classes", () => {
    const source = lines(
      'const a = "shadow";',
      'const b = "hover:shadow-md";',
      'const c = "drop-shadow-lg inset-shadow-sm text-shadow-sm";',
    );
    expect(lintText(source, COMPONENT).map((violation) => violation.line)).toEqual([1, 2, 3, 3, 3]);
  });

  it("flags ring offsets, which are drawn with a shadow", () => {
    const source = 'const cls = "focus:ring-2 focus:ring-offset-2 ring-inset";';
    expect(lintText(source, COMPONENT).map((violation) => violation.text)).toEqual([
      "ring-2",
      "ring-offset",
      "ring-inset",
    ]);
  });

  it("flags box-shadow and text-shadow in CSS and in a style object", () => {
    expect(rules(lintText(".probe { box-shadow: 0 1px 2px var(--ink); }", STYLESHEET))).toEqual([
      "shadow",
    ]);
    expect(rules(lintText(".probe { text-shadow: 0 0 2px var(--ink); }", STYLESHEET))).toEqual([
      "shadow",
    ]);
    expect(rules(lintText('const style = { boxShadow: "var(--shadow)" };', COMPONENT))).toEqual([
      "shadow",
    ]);
    expect(
      rules(lintText('const style = { filter: "drop-shadow(0 0 4px var(--ink))" };', COMPONENT)),
    ).toEqual(["shadow"]);
  });

  it("accepts a reset to none and theme resets", () => {
    const source = lines(
      "@theme inline {",
      "  --shadow-*: initial;",
      "  --inset-shadow-*: initial;",
      "  --text-shadow-*: initial;",
      "}",
      "[data-sonner-toast]:focus-visible { box-shadow: none !important; }",
    );
    expect(lintText(source, STYLESHEET)).toEqual([]);
    expect(lintText("const style = { boxShadow: 'none' };", COMPONENT)).toEqual([]);
  });
});

describe("gradients", () => {
  it("flags Tailwind gradient classes", () => {
    const source = lines(
      'const a = "bg-gradient-to-r from-ink to-surface";',
      'const b = "bg-linear-to-b via-rule";',
      'const c = "bg-radial bg-conic-180";',
    );
    expect(lintText(source, COMPONENT).map((violation) => violation.text)).toEqual([
      "bg-gradient",
      "from-ink",
      "to-surface",
      "bg-linear",
      "via-rule",
      "bg-radial",
      "bg-conic",
    ]);
  });

  it("flags CSS gradient functions and SVG gradient elements", () => {
    expect(
      rules(
        lintText(
          ".probe { background-image: linear-gradient(var(--ink), var(--rule)); }",
          STYLESHEET,
        ),
      ),
    ).toEqual(["gradient"]);
    expect(
      rules(lintText(".probe { mask: radial-gradient(circle, #000, transparent); }", STYLESHEET)),
    ).toEqual(["gradient", "raw-color"]);
    expect(rules(lintText("conic-gradient(var(--ink), var(--surface))", STYLESHEET))).toEqual([
      "gradient",
    ]);
    expect(rules(lintText("const el = <linearGradient id={id} />;", COMPONENT))).toEqual([
      "gradient",
    ]);
  });

  it("accepts animation utilities that contain from-", () => {
    const source =
      'const cls = "slide-in-from-top-2 data-open:fade-in-0 zoom-in-95 from-left text-ink";';
    expect(lintText(source, COMPONENT)).toEqual([]);
  });
});

describe("blur", () => {
  it("flags blur and backdrop classes", () => {
    const source = lines(
      'const a = "backdrop-blur-md";',
      'const b = "blur-sm md:blur-[2px]";',
      'const c = "backdrop-filter";',
    );
    expect(lintText(source, COMPONENT).map((violation) => violation.line)).toEqual([1, 2, 2, 3]);
  });

  it("flags blur filters and backdrop filters in CSS and in a style object", () => {
    expect(rules(lintText(".probe { filter: blur(4px); }", STYLESHEET))).toEqual(["blur"]);
    expect(rules(lintText(".probe { backdrop-filter: blur(8px); }", STYLESHEET))).toEqual([
      "blur",
      "blur",
    ]);
    expect(rules(lintText('const style = { backdropFilter: "saturate(2)" };', COMPONENT))).toEqual([
      "blur",
    ]);
    expect(
      rules(lintText('const style = { WebkitBackdropFilter: "blur(2px)" };', COMPONENT)),
    ).toEqual(["blur", "blur"]);
  });

  it("accepts the blur event and the blur method", () => {
    const source = lines(
      "<input onBlur={commit} />;",
      "document.activeElement.blur();",
      'window.addEventListener("blur", pause);',
      "const style = { backdropFilter: 'none' };",
    );
    expect(lintText(source, COMPONENT)).toEqual([]);
  });
});

describe("emoji", () => {
  it("flags an emoji in a string with its column", () => {
    const source = lines("export const label = {", '  done: "Fini 🙂",', "};");
    expect(lintText(source, COMPONENT)).toEqual([
      { rule: "emoji", line: 2, column: 15, text: "🙂" },
    ]);
  });

  it("flags an emoji in a comment and in a stylesheet", () => {
    expect(rules(lintText("// ok ✅", COMPONENT))).toEqual(["emoji"]);
    expect(rules(lintText('.probe::after { content: "🔥"; }', STYLESHEET))).toEqual(["emoji"]);
  });

  it("reports an emoji sequence once", () => {
    expect(lintText('const a = "👩‍🔬 🇫🇷 👍🏽 ⚠️ 1️⃣";', COMPONENT)).toHaveLength(5);
  });

  it("accepts the typographic symbols of the project", () => {
    const source = lines(
      'const arrow = "Expliquer →";',
      'const unit = "m² · 3 × 4 ≠ 5 ½ − 2 – 1 — 0 ≤ ∞ µ Ω θ π Δ °";',
      'const sign = "© ® ™ ↔";',
      'const tick = "✓ ✗ « » … ’";',
    );
    expect(lintText(source, COMPONENT)).toEqual([]);
  });
});

describe("clean sources", () => {
  it("returns nothing for a restyled component", () => {
    const source = lines(
      '"use client";',
      "",
      'import { cn } from "@/lib/utils";',
      "",
      "const BORDER = 2;",
      "",
      "export function Field({ className }: { className?: string }) {",
      "  return (",
      "    <label",
      "      className={cn(",
      '        "text-body touch-target border-b-2 border-ink bg-transparent text-ink",',
      '        "data-open:animate-in data-open:fade-in-0 hover:bg-surface-sunk",',
      "        className,",
      "      )}",
      "    >",
      "      Je n’ai pas compris →",
      "    </label>",
      "  );",
      "}",
    );
    expect(lintText(source, COMPONENT)).toEqual([]);
  });

  it("returns nothing for a stylesheet that uses variables only", () => {
    const source = lines(
      "/* no #fff, no rounded corner, no box-shadow: 0 0 1px red */",
      ":focus-visible {",
      "  outline: var(--focus-width) solid var(--ink);",
      "  outline-offset: var(--focus-offset);",
      "}",
    );
    expect(lintText(source, STYLESHEET)).toEqual([]);
  });

  it("sorts the violations of a file by position", () => {
    const source = lines('const a = "rounded-lg #fff";', 'const b = "shadow-md";');
    expect(lintText(source, COMPONENT)).toMatchObject([
      { rule: "radius", line: 1 },
      { rule: "raw-color", line: 1 },
      { rule: "shadow", line: 2 },
    ]);
  });
});
