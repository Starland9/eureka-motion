export const SPACE_UNIT_PX = 4;

export const spaceScale = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128] as const;

export const grid = {
  columns: 12,
  gutterPx: 24,
  marginPx: { phone: 16, tablet: 32, desktop: 64 },
  maxContentWidthPx: 1200,
} as const;

export const breakpointsPx = [360, 640, 768, 1024, 1280, 1440] as const;

export const RADIUS_PX = 0;

export const strokesPx = {
  hairline: 1,
  line: 1,
  strong: 2,
} as const;

export const focusRing = { widthPx: 2, offsetPx: 2 } as const;

export const TOUCH_TARGET_PX = 44;

export const iconSizesPx = [20, 24] as const;
export const ICON_STROKE_PX = 1.5;

export const zIndex = { content: 0, sticky: 10, menu: 20, scrim: 40, dialog: 50 } as const;
