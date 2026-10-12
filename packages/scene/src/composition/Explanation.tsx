import { useMemo } from "react";
import { AbsoluteFill, Series, useVideoConfig } from "remotion";
import type { Language } from "../expr";
import type { Model, Param, Scene } from "../schema/document";
import { FPS, getTheme, type ThemeName } from "../tokens";
import { SceneView } from "./SceneView";
import { buildTimeline } from "./timeline";

export interface ExplanationProps extends Record<string, unknown> {
  scenes: readonly Scene[];
  params: readonly Param[];
  model: Model;
  language: Language;
  theme: ThemeName;
  values?: Readonly<Record<string, number>>;
  reducedMotion?: boolean;
  disableSweeps?: boolean;
  burnSubtitles?: boolean;
  assetBaseUrl?: string;
}

const NO_VALUES: Readonly<Record<string, number>> = {};

export function Explanation(props: ExplanationProps) {
  const { fps } = useVideoConfig();
  const timeline = useMemo(() => buildTimeline(props.scenes, fps), [props.scenes, fps]);
  const theme = getTheme(props.theme);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.surfaceRaised }}>
      <Series>
        {timeline.scenes.map((timing, index) => (
          <Series.Sequence key={timing.id} durationInFrames={timing.duration} premountFor={fps}>
            <SceneView
              scene={props.scenes[index] as Scene}
              timing={timing}
              params={props.params}
              model={props.model}
              language={props.language}
              theme={props.theme}
              values={props.values ?? NO_VALUES}
              reducedMotion={props.reducedMotion ?? false}
              disableSweeps={props.disableSweeps ?? false}
              burnSubtitles={props.burnSubtitles ?? false}
              assetBaseUrl={props.assetBaseUrl ?? ""}
            />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
}

export function explanationDurationInFrames(scenes: readonly Scene[], fps: number = FPS): number {
  return Math.max(1, buildTimeline(scenes, fps).duration);
}
