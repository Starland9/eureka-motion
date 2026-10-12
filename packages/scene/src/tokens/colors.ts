export type ThemeName = "paper" | "board";

export const THEME_NAMES: readonly ThemeName[] = ["paper", "board"];

export interface SurfaceTokens {
  surface: string;
  surfaceRaised: string;
  surfaceSunk: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  rule: string;
}

export const surfaces: Readonly<Record<ThemeName, SurfaceTokens>> = {
  paper: {
    surface: "#F3EEE3",
    surfaceRaised: "#FBF8F1",
    surfaceSunk: "#E9E2D3",
    ink: "#16171A",
    inkSoft: "#4A4B4F",
    inkFaint: "#5E5D58",
    rule: "#B9B2A2",
  },
  board: {
    surface: "#141C19",
    surfaceRaised: "#1C2622",
    surfaceSunk: "#0F1613",
    ink: "#ECE7DA",
    inkSoft: "#A9AFA6",
    inkFaint: "#8A918A",
    rule: "#3A4741",
  },
};

export type RoleName = "quantity" | "action" | "result" | "valid";

export const ROLE_NAMES: readonly RoleName[] = ["quantity", "action", "result", "valid"];

export interface RoleTokens {
  quantity: string;
  action: string;
  result: string;
  valid: string;
  actionText: string;
}

export const roles: Readonly<Record<ThemeName, RoleTokens>> = {
  paper: {
    quantity: "#1D4E9E",
    action: "#C8371F",
    result: "#E9B429",
    valid: "#2C6E49",
    actionText: "#A82A15",
  },
  board: {
    quantity: "#86B6F0",
    action: "#F28A72",
    result: "#F2CB5B",
    valid: "#8CCB9A",
    actionText: "#F28A72",
  },
};

export const SCRIM_OPACITY = 0.4;

export const DATA_SERIES: readonly ("ink" | Exclude<RoleName, "result">)[] = [
  "ink",
  "quantity",
  "action",
  "valid",
];

export const HATCH_ANGLES_DEG: readonly number[] = [45, -45];
