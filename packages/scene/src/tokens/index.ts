import { roles, surfaces, type RoleTokens, type SurfaceTokens, type ThemeName } from "./colors";

export * from "./colors";
export * from "./contrast";
export * from "./css";
export * from "./motion";
export * from "./scene-metrics";
export * from "./space";
export * from "./typography";

export interface Theme extends SurfaceTokens {
  name: ThemeName;
  role: RoleTokens;
}

export function getTheme(name: ThemeName): Theme {
  return { name, ...surfaces[name], role: roles[name] };
}

export type SceneColour = "ink" | "inkSoft" | "inkFaint" | "rule" | keyof RoleTokens;

export function resolveColour(theme: Theme, colour: SceneColour): string {
  switch (colour) {
    case "ink":
      return theme.ink;
    case "inkSoft":
      return theme.inkSoft;
    case "inkFaint":
      return theme.inkFaint;
    case "rule":
      return theme.rule;
    default:
      return theme.role[colour];
  }
}
