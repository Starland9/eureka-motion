export const CANVAS = { width: 1920, height: 1080 } as const;

export const UNITS_ACROSS = { landscape: 120, portrait: 72 } as const;

export function unitPx(
  canvasWidth: number,
  format: keyof typeof UNITS_ACROSS = "landscape",
): number {
  return canvasWidth / UNITS_ACROSS[format];
}

export const sceneMetrics = {
  safeMargin: 6,
  bottomBand: 10,
  text: {
    min: 4,
    label: 4,
    body: 4.5,
    title: 7,
    formula: 8,
  },
  stroke: {
    construction: 0.125,
    regular: 0.25,
    accent: 0.5,
  },
  labelRise: 0.25,
  sceneSlide: 1,
} as const;

export const sceneLimits = {
  maxElements: 14,
  maxVisibleLabels: 6,
  maxColourRoles: 3,
  maxTitleChars: 60,
  maxTextChars: 140,
  maxNarrationChars: 200,
  maxTitleLines: 2,
} as const;
