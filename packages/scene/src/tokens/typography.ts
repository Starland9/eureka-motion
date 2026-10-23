export const fontFamilies = {
  display: "Bodoni Moda",
  text: "STIX Two Text",
  mono: "IBM Plex Mono",
} as const;

export type FontRole = keyof typeof fontFamilies;

export const fontStacks: Readonly<Record<FontRole, string>> = {
  display: `"Bodoni Moda", "STIX Two Text", "KaTeX_Main", "Times New Roman", serif`,
  text: `"STIX Two Text", "KaTeX_Main", "Times New Roman", serif`,
  mono: `"IBM Plex Mono", "STIX Two Text", "KaTeX_Main", ui-monospace, monospace`,
};

const MONO_LOOKALIKES: Readonly<Record<string, string>> = {
  "\u03A9": "\u2126", // Ω → ohm sign
  "\u03BC": "\u00B5", // μ → micro sign
  "\u0394": "\u2206", // Δ → increment
};

export function monoSafe(text: string): string {
  return text.replace(/[\u03A9\u03BC\u0394]/g, (ch) => MONO_LOOKALIKES[ch] ?? ch);
}

export const fontCssVariables: Readonly<Record<FontRole, string>> = {
  display: "--font-display",
  text: "--font-text",
  mono: "--font-mono",
};

export interface TypeStyle {
  font: FontRole;
  size: number | string;
  lineHeight: number;
  weight: number;
  uppercase?: boolean;
  tracking?: number;
  tabularNumbers?: boolean;
}

export const typeScale = {
  displayXl: { font: "display", size: "clamp(44px, 9vw, 96px)", lineHeight: 1.02, weight: 600 },
  displayL: { font: "display", size: 60, lineHeight: 1.05, weight: 500 },
  displayM: { font: "display", size: 44, lineHeight: 1.1, weight: 500 },
  title: { font: "display", size: 32, lineHeight: 1.15, weight: 600 },
  lead: { font: "text", size: 24, lineHeight: 1.35, weight: 400 },
  bodyL: { font: "text", size: 20, lineHeight: 1.5, weight: 400 },
  body: { font: "text", size: 17, lineHeight: 1.6, weight: 400 },
  control: { font: "text", size: 17, lineHeight: 1.2, weight: 600 },
  caption: {
    font: "mono",
    size: 13,
    lineHeight: 1.4,
    weight: 500,
    uppercase: true,
    tracking: 0.06,
  },
  data: { font: "mono", size: 15, lineHeight: 1.3, weight: 400, tabularNumbers: true },
} as const satisfies Record<string, TypeStyle>;

export type TypeStyleName = keyof typeof typeScale;

export const DISPLAY_MIN_SIZE_PX = 28;

// A plate is scaled down in the page: the automatic optical size would thin the
// hairlines of the display face below one pixel.
export const SCENE_DISPLAY_OPTICAL_SIZE = 18;

export const MEASURE_CH = { min: 60, max: 72 } as const;
