"use client";

import { useTranslations } from "next-intl";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { Language, Param } from "scene";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  clampToRange,
  commitEntry,
  editText,
  formatValue,
  fractionOf,
  snapToStep,
  tidy,
} from "./params-values";

const GRADUATIONS = 10;
const MAJOR_EVERY = 5;

const RANGE = [
  "absolute inset-0 m-0 h-11 w-full cursor-pointer appearance-none bg-transparent p-0",
  "[&::-webkit-slider-runnable-track]:h-11 [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:mt-3.5 [&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-role-quantity [&::-webkit-slider-thumb]:bg-surface-raised",
  "[&::-moz-range-track]:h-11 [&::-moz-range-track]:bg-transparent",
  "[&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-role-quantity [&::-moz-range-thumb]:bg-surface-raised",
  "focus-visible:[&::-webkit-slider-thumb]:bg-role-quantity focus-visible:[&::-moz-range-thumb]:bg-role-quantity",
].join(" ");

export interface ParamRowProps {
  param: Param;
  value: number;
  language: Language;
  onChange(id: string, value: number): void;
  onAdjustingChange?(adjusting: boolean): void;
  onNotice(message: string): void;
}

export function ParamRow({
  param,
  value,
  language,
  onChange,
  onAdjustingChange,
  onNotice,
}: ParamRowProps) {
  const t = useTranslations("Params");
  const id = useId();
  const nameId = `${id}-name`;
  const rangeId = `${id}-range`;
  const tagId = `${id}-tag`;
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const selectDraft = useRef(false);

  useLayoutEffect(() => {
    if (!selectDraft.current) return;
    selectDraft.current = false;
    field.current?.select();
  });

  const startEditing = (text: string): void => {
    selectDraft.current = true;
    setDraft(text);
  };

  const withUnit = (text: string): string =>
    param.unit === "" ? text : t("withUnit", { value: text, unit: param.unit });
  const display = (amount: number): string => withUnit(formatValue(amount, language));

  const snapped = snapToStep(value, param);
  const ruler = { "--p": fractionOf(snapped, param) } as CSSProperties;

  const adjusting = (on: boolean): void => onAdjustingChange?.(on);

  const commit = (keepEditing: boolean): void => {
    const entry = commitEntry(draft ?? "", param, language);
    let next = value;
    if (entry.kind === "value") {
      next = entry.value;
      if (next !== value) onChange(param.id, next);
      if (entry.clamped) onNotice(t("clamped", { label: param.label, value: display(next) }));
    } else {
      onNotice(t("invalid", { label: param.label, value: display(value) }));
    }
    if (keepEditing) startEditing(editText(next, language));
    else setDraft(null);
  };

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      startEditing(editText(value, language));
    }
  };

  return (
    <li className="grid gap-x-6 gap-y-1 border-b border-rule py-4 @xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,12rem)] @xl:items-start">
      <label id={nameId} htmlFor={rangeId} className="text-body min-w-0 @xl:pt-2">
        <i className="pr-1 text-role-quantity after:content-['_']">{param.symbol}</i>
        {param.label}
      </label>

      <div className="min-w-0">
        <div className="relative h-11">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={ruler}>
            <span className="absolute inset-x-2 top-5.25 h-0.5 bg-role-quantity" />
            <span className="absolute top-4.75 left-2 h-1.5 w-[calc((100%-1rem)*var(--p))] bg-role-quantity" />
            <span className="absolute inset-x-2 top-5.75 flex justify-between">
              {Array.from({ length: GRADUATIONS + 1 }, (_, index) => (
                <span
                  key={index}
                  className={cn("w-px bg-role-quantity", index % MAJOR_EVERY === 0 ? "h-3" : "h-2")}
                />
              ))}
            </span>
          </div>
          <input
            id={rangeId}
            type="range"
            min={param.min}
            max={param.max}
            step={param.step}
            value={snapped}
            aria-valuetext={display(value)}
            className={RANGE}
            onChange={(event) =>
              onChange(param.id, clampToRange(tidy(Number(event.target.value)), param))
            }
            onPointerDown={() => adjusting(true)}
            onPointerUp={() => adjusting(false)}
            onPointerCancel={() => adjusting(false)}
            onKeyDown={() => adjusting(true)}
            onKeyUp={() => adjusting(false)}
            onBlur={() => adjusting(false)}
          />
        </div>
        <div aria-hidden="true" className="text-data flex justify-between gap-4 text-ink-soft">
          <span>{formatValue(param.min, language)}</span>
          <span>{formatValue(param.max, language)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          ref={field}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          aria-labelledby={`${nameId} ${tagId}`}
          aria-describedby={hintId}
          value={draft ?? formatValue(value, language)}
          className="text-data w-40"
          onFocus={() => startEditing(editText(value, language))}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(false)}
          onKeyDown={onFieldKeyDown}
        />
        {param.unit !== "" && <span className="text-data text-ink-soft">{param.unit}</span>}
        <span id={tagId} className="sr-only">
          {t("entryTag")}
        </span>
        <span id={hintId} className="sr-only">
          {t("entryRange", { min: display(param.min), max: display(param.max) })}
        </span>
      </div>
    </li>
  );
}
