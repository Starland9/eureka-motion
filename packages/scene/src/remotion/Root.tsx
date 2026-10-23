import { Composition, type CalculateMetadataFunction } from "remotion";
import {
  EXPORT_COMPOSITION_ID,
  EXPORT_DEFAULT_PROPS,
  EXPORT_FPS,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  ExportComposition,
  exportDurationInFrames,
  type ExportInputProps,
} from "../composition/Export";

export const calculateExportMetadata: CalculateMetadataFunction<ExportInputProps> = ({
  props,
}) => ({
  durationInFrames: exportDurationInFrames(props.document),
});

export function RemotionRoot() {
  return (
    <Composition
      id={EXPORT_COMPOSITION_ID}
      component={ExportComposition}
      width={EXPORT_WIDTH}
      height={EXPORT_HEIGHT}
      fps={EXPORT_FPS}
      durationInFrames={exportDurationInFrames(EXPORT_DEFAULT_PROPS.document)}
      defaultProps={EXPORT_DEFAULT_PROPS}
      calculateMetadata={calculateExportMetadata}
    />
  );
}
