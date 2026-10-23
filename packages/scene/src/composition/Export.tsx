import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Language } from "../expr";
import { createFrame, type Frame } from "../layouts";
import type { ExplanationDocument, Scene } from "../schema/document";
import {
  CANVAS,
  FPS,
  fontStacks,
  getTheme,
  sceneMetrics,
  typeScale,
  type Theme,
  type ThemeName,
} from "../tokens";
import { Explanation, explanationDurationInFrames } from "./Explanation";
import { buildTimeline, locate } from "./timeline";

export const EXPORT_COMPOSITION_ID = "export";
export const EXPORT_THEME: ThemeName = "paper";
export const EXPORT_FPS = FPS;
export const EXPORT_WIDTH = CANVAS.width;
export const EXPORT_HEIGHT = CANVAS.height;

export type ExportDocument = Pick<ExplanationDocument, "scenes" | "params" | "model">;

export interface ExportInputProps extends Record<string, unknown> {
  document: ExportDocument;
  language: Language;
  assetBaseUrl?: string;
  values?: Readonly<Record<string, number>>;
}

export const EXPORT_DEFAULT_PROPS: ExportInputProps = {
  document: { scenes: [], params: [], model: { constants: [], derived: [] } },
  language: "fr",
};

const MARK_INSET_U = 1.5;
const MARK_ARM_U = 3;
const LEGEND_SIZE_U = 2;
const MONO_ADVANCE_EM = 0.6;
const SUBTITLE_SIZE_U = 3.2;
const SUBTITLE_LINES = 2;
const SUBTITLE_LINE_HEIGHT = 1.25;
// Average advance of STIX Two Text in French prose, plus slack for ragged line ends.
const SUBTITLE_CHARACTER_EM = 0.44;
const SUBTITLE_WRAP_SLACK = 1.1;
const NBSP = "\u00a0";

export function exportDurationInFrames(document: Pick<ExportDocument, "scenes">): number {
  return explanationDurationInFrames(document.scenes, EXPORT_FPS);
}

// Same numbering as the figure caption of the player: the index a scene carries, else the
// first free slot.
function figureNumbers(scenes: readonly Scene[]): number[] {
  const taken = new Set<number>();
  const own = scenes.map((scene) => {
    const usable = Number.isInteger(scene.index) && scene.index >= 0 && !taken.has(scene.index);
    if (usable) taken.add(scene.index);
    return usable ? scene.index : null;
  });
  return own.map((slot, position) => {
    if (slot !== null) return slot + 1;
    let next = position;
    while (taken.has(next)) next += 1;
    taken.add(next);
    return next + 1;
  });
}

function PrintMarks({ theme, geometry }: { theme: Theme; geometry: Frame }) {
  const { width, height, u } = geometry;
  const inset = MARK_INSET_U * u;
  const arm = MARK_ARM_U * u;
  const right = width - inset - arm;
  const bottom = height - inset - arm;
  const corners = [
    { x: inset + arm, y: inset + arm, sx: -1, sy: -1 },
    { x: right, y: inset + arm, sx: 1, sy: -1 },
    { x: inset + arm, y: bottom, sx: -1, sy: 1 },
    { x: right, y: bottom, sx: 1, sy: 1 },
  ];
  return (
    <svg
      data-export="marks"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0 }}
    >
      {corners.map(({ x, y, sx, sy }) => (
        <path
          key={`${sx}${sy}`}
          d={`M ${x + sx * arm} ${y} L ${x} ${y} L ${x} ${y + sy * arm}`}
          fill="none"
          stroke={theme.ink}
          strokeWidth={sceneMetrics.stroke.regular * u}
          strokeLinejoin="miter"
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}

function FigureLegend({ text, theme, geometry }: { text: string; theme: Theme; geometry: Frame }) {
  const { width, u } = geometry;
  const margin = sceneMetrics.safeMargin * u;
  const caption = typeScale.caption;
  const advance = MONO_ADVANCE_EM + caption.tracking;
  const size = Math.min(LEGEND_SIZE_U * u, (width - 2 * margin) / (text.length * advance));
  return (
    <div
      data-export="legend"
      style={{
        position: "absolute",
        left: margin,
        right: margin,
        top: 0,
        height: margin,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        fontFamily: fontStacks.mono,
        fontWeight: caption.weight,
        fontSize: size,
        letterSpacing: `${caption.tracking}em`,
        lineHeight: 1,
        color: theme.inkSoft,
      }}
    >
      {text}
    </div>
  );
}

// Two lines at most in the band: a long narration is set smaller instead of overflowing it.
function Subtitle({ text, theme, geometry }: { text: string; theme: Theme; geometry: Frame }) {
  const { band, u } = geometry;
  const fitted =
    (SUBTITLE_LINES * band.width) / (text.length * SUBTITLE_CHARACTER_EM * SUBTITLE_WRAP_SLACK);
  return (
    <div
      data-export="subtitles"
      style={{
        position: "absolute",
        left: band.x,
        top: band.y,
        width: band.width,
        height: band.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontFamily: fontStacks.text,
        fontSize: Math.min(SUBTITLE_SIZE_U * u, fitted),
        lineHeight: SUBTITLE_LINE_HEIGHT,
        color: theme.ink,
      }}
    >
      {text}
    </div>
  );
}

function Overlay({
  scenes,
  theme,
  geometry,
}: {
  scenes: readonly Scene[];
  theme: Theme;
  geometry: Frame;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useMemo(() => buildTimeline(scenes, fps), [scenes, fps]);
  const numbers = useMemo(() => figureNumbers(scenes), [scenes]);
  const location = locate(timeline, frame);
  const scene = location ? scenes[location.scene.index] : undefined;
  const number = location ? numbers[location.scene.index] : undefined;
  if (!location || !scene || number === undefined) return null;
  const figure = `Fig.${NBSP}${String(number).padStart(2, "0")}${NBSP}— ${scene.title}`;
  return (
    <>
      <FigureLegend text={figure} theme={theme} geometry={geometry} />
      <Subtitle text={location.beat.narration} theme={theme} geometry={geometry} />
    </>
  );
}

export function ExportComposition({
  document,
  language,
  assetBaseUrl = "",
  values,
}: ExportInputProps) {
  const theme = getTheme(EXPORT_THEME);
  const { width, height } = useVideoConfig();
  const geometry = createFrame(width, height);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.surfaceRaised }}>
      <Explanation
        scenes={document.scenes}
        params={document.params}
        model={document.model}
        language={language}
        theme={EXPORT_THEME}
        values={values}
        reducedMotion={false}
        disableSweeps={false}
        assetBaseUrl={assetBaseUrl}
      />
      <PrintMarks theme={theme} geometry={geometry} />
      <Overlay scenes={document.scenes} theme={theme} geometry={geometry} />
    </AbsoluteFill>
  );
}
