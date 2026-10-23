// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const SOURCE_FILES = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

const LETTER = "/\\p{L}/u";
const USER_TEXT_ATTRIBUTES =
  "aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|title|placeholder|alt";
const HARDCODED_TEXT =
  "Visible text must come from the translation files (apps/web/messages), not from a literal in the source (FR-038).";

const wordsIn = (container) => [
  `${container} > Literal[value=${LETTER}]`,
  `${container} > TemplateLiteral > TemplateElement[value.cooked=${LETTER}]`,
  `${container} > :matches(ConditionalExpression, LogicalExpression, BinaryExpression) > Literal[value=${LETTER}]`,
];

const HARDCODED_TEXT_SELECTORS = [
  `JSXText[value=${LETTER}]`,
  ...wordsIn(":matches(JSXElement, JSXFragment) > JSXExpressionContainer"),
  `JSXAttribute[name.name=/^(${USER_TEXT_ATTRIBUTES})$/] > Literal[value=${LETTER}]`,
  ...wordsIn(`JSXAttribute[name.name=/^(${USER_TEXT_ATTRIBUTES})$/] > JSXExpressionContainer`),
];

export default defineConfig([
  globalIgnores([
    "**/node_modules",
    "**/.next",
    "**/dist",
    "**/coverage",
    "**/playwright-report",
    "**/test-results",
    "**/next-env.d.ts",
    ".claude",
    ".specify",
    "specs",
    "design-system",
    "docs",
  ]),

  // Base rules for every workspace.
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [SOURCE_FILES],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // React hooks rules (rules of hooks + exhaustive deps + React Compiler checks).
  reactHooks.configs.flat.recommended,

  // Next.js rules, only for the web application.
  {
    files: ["apps/web/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },

  // packages/scene must compile identically in Next.js and in Remotion's bundler
  // (research.md § 2.4): no Next.js import, no path alias, no CSS class names.
  {
    files: ["packages/scene/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "packages/scene must not depend on Next.js: it is also bundled by Remotion's bundler (research.md § 2.4).",
            },
            {
              group: ["@/*"],
              message:
                "packages/scene must not use the '@/' path alias: Remotion's bundler does not resolve it. Use a relative import.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='className']",
          message:
            "Do not use className in packages/scene: scene primitives are styled from tokens with inline styles (style={...}), not CSS or Tailwind classes.",
        },
      ],
    },
  },

  // FR-038: every visible text of the web application lives in the translation files.
  // The workbenches under dev/ are development tools and keep their texts as literals.
  {
    files: ["apps/web/src/**/*.{jsx,tsx}"],
    ignores: ["apps/web/src/app/*/dev/**", "apps/web/src/components/dev/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...HARDCODED_TEXT_SELECTORS.map((selector) => ({ selector, message: HARDCODED_TEXT })),
      ],
    },
  },
]);
