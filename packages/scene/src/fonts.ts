export interface FontFaceSpec {
  family: string;
  file: string;
  weight: string;
  style: "normal" | "italic";
}

export const FONT_FACES: readonly FontFaceSpec[] = [
  { family: "Bodoni Moda", file: "bodoni-moda-variable.woff2", weight: "400 900", style: "normal" },
  {
    family: "Bodoni Moda",
    file: "bodoni-moda-variable-italic.woff2",
    weight: "400 900",
    style: "italic",
  },
  {
    family: "STIX Two Text",
    file: "stix-two-text-variable.woff2",
    weight: "400 700",
    style: "normal",
  },
  {
    family: "STIX Two Text",
    file: "stix-two-text-variable-italic.woff2",
    weight: "400 700",
    style: "italic",
  },
  { family: "IBM Plex Mono", file: "ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
  {
    family: "IBM Plex Mono",
    file: "ibm-plex-mono-400-italic.woff2",
    weight: "400",
    style: "italic",
  },
  { family: "IBM Plex Mono", file: "ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  {
    family: "IBM Plex Mono",
    file: "ibm-plex-mono-500-italic.woff2",
    weight: "500",
    style: "italic",
  },
];

export const PRELOAD_FONT_FILES: readonly string[] = [
  "bodoni-moda-variable.woff2",
  "stix-two-text-variable.woff2",
  "ibm-plex-mono-500.woff2",
];

export function fontFaceCss(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return FONT_FACES.map(
    (face) =>
      `@font-face{font-family:"${face.family}";src:url("${base}/${face.file}") format("woff2");` +
      `font-weight:${face.weight};font-style:${face.style};font-display:swap;}`,
  ).join("\n");
}
