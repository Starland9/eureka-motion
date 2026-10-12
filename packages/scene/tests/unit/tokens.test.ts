import { describe, expect, it } from "vitest";
import {
  colorCssVariables,
  contrastRatio,
  cssBezier,
  durationFrames,
  getTheme,
  msToFrames,
  resolveColour,
  roles,
  sceneMetrics,
  staticCssVariables,
  surfaces,
  THEME_NAMES,
  unitPx,
} from "../../src/tokens";

const TOLERANCE = 0.1;

const textOnSurfaces = {
  paper: {
    ink: [15.5, 16.9, 13.9],
    inkSoft: [7.5, 8.2, 6.8],
    inkFaint: [5.7, 6.2, 5.1],
  },
  board: {
    ink: [14.1, 12.6, 14.9],
    inkSoft: [7.7, 6.9, 8.2],
    inkFaint: [5.4, 4.8, 5.7],
  },
} as const;

const rolesOnSurface = {
  paper: { quantity: 6.9, action: 4.5, result: 1.7, valid: 5.3, actionText: 6.0 },
  board: { quantity: 8.2, action: 7.2, result: 11.1, valid: 9.2, actionText: 7.2 },
} as const;

describe("colour tokens", () => {
  for (const theme of THEME_NAMES) {
    const s = surfaces[theme];
    const backgrounds = [s.surface, s.surfaceRaised, s.surfaceSunk];

    it(`${theme}: text contrast matches the design system`, () => {
      for (const token of ["ink", "inkSoft", "inkFaint"] as const) {
        backgrounds.forEach((bg, i) => {
          const expected = textOnSurfaces[theme][token][i];
          expect(expected).toBeDefined();
          expect(Math.abs(contrastRatio(s[token], bg) - (expected as number))).toBeLessThanOrEqual(
            TOLERANCE,
          );
        });
      }
    });

    it(`${theme}: role contrast on the page surface matches the design system`, () => {
      for (const role of ["quantity", "action", "result", "valid", "actionText"] as const) {
        const ratio = contrastRatio(roles[theme][role], s.surface);
        expect(Math.abs(ratio - rolesOnSurface[theme][role])).toBeLessThanOrEqual(TOLERANCE);
      }
    });

    it(`${theme}: every text token reaches AA on every surface`, () => {
      for (const token of ["ink", "inkSoft", "inkFaint"] as const) {
        for (const bg of backgrounds) {
          expect(contrastRatio(s[token], bg)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${theme}: roles used as text or thin strokes reach 4.5:1 on the page`, () => {
      const textRoles =
        theme === "paper"
          ? (["quantity", "valid", "actionText"] as const)
          : (["quantity", "action", "result", "valid"] as const);
      for (const role of textRoles) {
        expect(contrastRatio(roles[theme][role], s.surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: ink set on the result highlight stays readable`, () => {
      const onResult = theme === "paper" ? s.ink : s.surface;
      expect(contrastRatio(onResult, roles[theme].result)).toBeGreaterThanOrEqual(7);
    });

    it(`${theme}: the decorative rule stays below 3:1, so it can never bound a control`, () => {
      expect(contrastRatio(s.rule, s.surface)).toBeLessThan(3);
    });
  }

  it("paper: the result yellow is unusable as text, by construction", () => {
    expect(contrastRatio(roles.paper.result, surfaces.paper.surface)).toBeLessThan(3);
  });
});

describe("theme helpers", () => {
  it("resolves scene colour references against the theme", () => {
    const theme = getTheme("paper");
    expect(resolveColour(theme, "ink")).toBe("#16171A");
    expect(resolveColour(theme, "quantity")).toBe("#1D4E9E");
    expect(resolveColour(getTheme("board"), "result")).toBe("#F2CB5B");
  });

  it("exposes the same CSS variable names in both themes", () => {
    expect(Object.keys(colorCssVariables("paper"))).toEqual(
      Object.keys(colorCssVariables("board")),
    );
    expect(colorCssVariables("paper")["--ink"]).toBe("#16171A");
    expect(staticCssVariables()["--radius"]).toBe("0px");
  });
});

describe("motion tokens", () => {
  it("converts durations to frames at 30 fps", () => {
    expect(msToFrames(600)).toBe(18);
    expect(msToFrames(240)).toBe(7);
    expect(msToFrames(10)).toBe(1);
    expect(durationFrames("settle")).toBe(27);
  });

  it("renders easings as CSS", () => {
    expect(cssBezier("arrive")).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(cssBezier("steady")).toBe("linear");
  });
});

describe("scene metrics", () => {
  it("defines one unit as a 120th of the canvas width", () => {
    expect(unitPx(1920)).toBe(16);
    expect(unitPx(360)).toBe(3);
  });

  it("keeps the smallest scene text at 12 px on a 360 px phone", () => {
    expect(sceneMetrics.text.min * unitPx(360)).toBe(12);
  });
});
