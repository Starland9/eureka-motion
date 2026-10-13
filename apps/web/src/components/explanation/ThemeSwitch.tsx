"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { ThemeName } from "scene";
import { setTheme, useTheme } from "@/lib/theme-client";

const THEMES = ["paper", "board"] as const satisfies readonly ThemeName[];

export function ThemeSwitch() {
  const t = useTranslations("Explanation.header");
  const tTheme = useTranslations("Theme");
  const name = useId();
  const theme = useTheme();

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{t("theme")}</legend>
      <div className="flex">
        {THEMES.map((value) => (
          <label
            key={value}
            className="touch-target text-caption relative inline-flex cursor-pointer items-center px-2 text-ink-soft hover:text-ink has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="peer sr-only"
            />
            <span className="underline-offset-8 peer-checked:underline peer-checked:decoration-2">
              {tTheme(value)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
