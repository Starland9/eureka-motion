import { roles, surfaces, SCRIM_OPACITY, type ThemeName } from "./colors";
import { cssBezier, durationsMs, type DurationName, type EasingName, easings } from "./motion";
import { focusRing, RADIUS_PX, strokesPx } from "./space";

export function colorCssVariables(theme: ThemeName): Record<string, string> {
  const s = surfaces[theme];
  const r = roles[theme];
  return {
    "--surface": s.surface,
    "--surface-raised": s.surfaceRaised,
    "--surface-sunk": s.surfaceSunk,
    "--ink": s.ink,
    "--ink-soft": s.inkSoft,
    "--ink-faint": s.inkFaint,
    "--rule": s.rule,
    "--role-quantity": r.quantity,
    "--role-action": r.action,
    "--role-result": r.result,
    "--role-valid": r.valid,
    "--role-action-text": r.actionText,
  };
}

export function staticCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {
    "--radius": `${RADIUS_PX}px`,
    "--stroke-hairline": `${strokesPx.hairline}px`,
    "--stroke-line": `${strokesPx.line}px`,
    "--stroke-strong": `${strokesPx.strong}px`,
    "--focus-width": `${focusRing.widthPx}px`,
    "--focus-offset": `${focusRing.offsetPx}px`,
    "--scrim-opacity": String(SCRIM_OPACITY),
  };
  for (const name of Object.keys(durationsMs) as DurationName[]) {
    vars[`--duration-${name}`] = `${durationsMs[name]}ms`;
  }
  for (const name of Object.keys(easings) as EasingName[]) {
    vars[`--ease-${name}`] = cssBezier(name);
  }
  return vars;
}
