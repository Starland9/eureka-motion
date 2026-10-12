import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneFrame, type SceneFrameProps } from "./SceneFrame";

export type SceneViewProps = Omit<SceneFrameProps, "frame" | "width" | "height" | "fps"> & {
  assetBaseUrl: string;
};

function resolveAsset(url: string, base: string): string {
  return /^[a-z]+:\/\//i.test(url) || base === "" ? url : `${base.replace(/\/$/, "")}${url}`;
}

export function SceneView({ assetBaseUrl, ...props }: SceneViewProps) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <SceneFrame {...props} frame={frame} width={width} height={height} fps={fps} />
      {props.timing.beats.map((item) =>
        item.audioUrl ? (
          <Sequence key={item.id} from={item.start} durationInFrames={item.duration} layout="none">
            <Audio src={resolveAsset(item.audioUrl, assetBaseUrl)} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
}
