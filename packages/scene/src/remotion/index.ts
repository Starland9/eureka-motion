import "katex/dist/katex.min.css";
import { loadFont } from "@remotion/fonts";
import { registerRoot } from "remotion";
import { FONT_FACES } from "../fonts";
import { RemotionRoot } from "./Root";

const FONT_URLS: Readonly<Record<string, string>> = {
  "bodoni-moda-variable.woff2": new URL(
    "../../assets/fonts/bodoni-moda-variable.woff2",
    import.meta.url,
  ).href,
  "bodoni-moda-variable-italic.woff2": new URL(
    "../../assets/fonts/bodoni-moda-variable-italic.woff2",
    import.meta.url,
  ).href,
  "stix-two-text-variable.woff2": new URL(
    "../../assets/fonts/stix-two-text-variable.woff2",
    import.meta.url,
  ).href,
  "stix-two-text-variable-italic.woff2": new URL(
    "../../assets/fonts/stix-two-text-variable-italic.woff2",
    import.meta.url,
  ).href,
  "ibm-plex-mono-400.woff2": new URL("../../assets/fonts/ibm-plex-mono-400.woff2", import.meta.url)
    .href,
  "ibm-plex-mono-400-italic.woff2": new URL(
    "../../assets/fonts/ibm-plex-mono-400-italic.woff2",
    import.meta.url,
  ).href,
  "ibm-plex-mono-500.woff2": new URL("../../assets/fonts/ibm-plex-mono-500.woff2", import.meta.url)
    .href,
  "ibm-plex-mono-500-italic.woff2": new URL(
    "../../assets/fonts/ibm-plex-mono-500-italic.woff2",
    import.meta.url,
  ).href,
};

for (const face of FONT_FACES) {
  const url = FONT_URLS[face.file];
  if (url === undefined) throw new Error(`no bundled file for font ${face.file}`);
  void loadFont({ family: face.family, url, weight: face.weight, style: face.style });
}

registerRoot(RemotionRoot);
