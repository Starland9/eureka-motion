import katex from "katex";
import { templateReferences } from "../expr";
import { roles } from "../tokens";

export const ROLE_MACRO_NAMES = {
  quantity: "\\q",
  action: "\\a",
  result: "\\res",
  valid: "\\ok",
} as const;

export interface RoleColours {
  quantity: string;
  action: string;
  result: string;
  valid: string;
}

export function roleMacros(colours: RoleColours): Record<string, string> {
  // No "#": inside a macro KaTeX reads "#0" as an argument number.
  const hex = (colour: string): string => colour.replace(/^#/, "");
  return {
    [ROLE_MACRO_NAMES.quantity]: `\\textcolor{${hex(colours.quantity)}}{#1}`,
    [ROLE_MACRO_NAMES.action]: `\\textcolor{${hex(colours.action)}}{#1}`,
    [ROLE_MACRO_NAMES.result]: `\\colorbox{${hex(colours.result)}}{$\\displaystyle #1$}`,
    [ROLE_MACRO_NAMES.valid]: `\\textcolor{${hex(colours.valid)}}{#1}`,
  };
}

const FORBIDDEN = [
  "href",
  "url",
  "includegraphics",
  "htmlClass",
  "htmlId",
  "htmlStyle",
  "htmlData",
  "def",
  "gdef",
  "edef",
  "xdef",
  "let",
  "futurelet",
  "newcommand",
  "renewcommand",
  "providecommand",
  "global",
  "color",
  "textcolor",
  "colorbox",
  "fcolorbox",
];
const FORBIDDEN_PATTERN = new RegExp(`\\\\(?:${FORBIDDEN.join("|")})(?![A-Za-z])`);

const PLACEHOLDER_COLOURS: RoleColours = roles.paper;

export const KATEX_OPTIONS = {
  throwOnError: true,
  strict: "ignore",
  trust: false,
  maxExpand: 200,
} as const;

export function stripInterpolations(tex: string): string {
  return tex.replace(/\{\{[^}]*\}\}/g, "1");
}

export function checkTex(tex: string): string | null {
  const forbidden = FORBIDDEN_PATTERN.exec(tex);
  if (forbidden) {
    return `command ${forbidden[0]} is not allowed; colour symbols only with \\q{…}, \\a{…}, \\res{…}, \\ok{…}`;
  }
  try {
    templateReferences(tex);
  } catch (error) {
    return (error as Error).message;
  }
  try {
    katex.renderToString(stripInterpolations(tex), {
      ...KATEX_OPTIONS,
      displayMode: true,
      macros: roleMacros(PLACEHOLDER_COLOURS),
    });
  } catch (error) {
    return `not valid KaTeX: ${(error as Error).message.replace(/^KaTeX parse error: /, "")}`;
  }
  return null;
}
