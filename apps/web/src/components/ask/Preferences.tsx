"use client";

import { useEffect, useId, useRef, type Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Level, ThemeName } from "scene";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { useChoicePreference } from "@/lib/preferences";
import { setTheme, useTheme } from "@/lib/theme-client";

export const LEVEL_PREFERENCE_KEY = "eureka.level";
export const LEVELS = ["college", "lycee", "superieur"] as const satisfies readonly Level[];

const REFOCUS_KEY = "eureka.refocus";
const REFOCUS_WINDOW_MS = 5000;

const THEMES = ["paper", "board"] as const satisfies readonly ThemeName[];

interface ChoiceGroupProps<T extends string> {
  groupRef?: Ref<HTMLFieldSetElement>;
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

function ChoiceGroup<T extends string>({
  groupRef,
  legend,
  name,
  options,
  value,
  onChange,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset ref={groupRef} className="min-w-0">
      <legend className="text-caption mb-1 text-ink-faint">{legend}</legend>
      <div className="-ml-2 flex flex-wrap gap-x-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="touch-target text-caption relative inline-flex cursor-pointer items-center px-2 text-ink-soft hover:text-ink has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="underline-offset-8 peer-checked:underline peer-checked:decoration-2">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Preferences() {
  const groupId = useId();
  const t = useTranslations("Ask.preferences");
  const tLanguage = useTranslations("Language");
  const tLevel = useTranslations("Level");
  const tTheme = useTranslations("Theme");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [level, setLevel] = useChoicePreference(LEVEL_PREFERENCE_KEY, LEVELS, "lycee");
  const theme = useTheme();
  const languageRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    let at = 0;
    try {
      at = Number(sessionStorage.getItem(REFOCUS_KEY));
    } catch {
      // Storage may be unavailable; the field keeps the focus.
    }
    if (Date.now() - at < REFOCUS_WINDOW_MS) {
      languageRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    }
  }, []);

  function switchLocale(next: Locale) {
    try {
      sessionStorage.setItem(REFOCUS_KEY, String(Date.now()));
    } catch {
      // Storage may be unavailable; the field takes the focus on the new page.
    }
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <ChoiceGroup<Locale>
        groupRef={languageRef}
        legend={t("language")}
        name={`${groupId}-language`}
        options={routing.locales.map((value) => ({ value, label: tLanguage(value) }))}
        value={locale}
        onChange={switchLocale}
      />
      <ChoiceGroup<Level>
        legend={t("level")}
        name={`${groupId}-level`}
        options={LEVELS.map((value) => ({ value, label: tLevel(value) }))}
        value={level}
        onChange={setLevel}
      />
      <ChoiceGroup<ThemeName>
        legend={t("theme")}
        name={`${groupId}-theme`}
        options={THEMES.map((value) => ({ value, label: tTheme(value) }))}
        value={theme}
        onChange={setTheme}
      />
    </div>
  );
}
