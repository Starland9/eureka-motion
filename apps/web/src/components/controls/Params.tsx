"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { Language, Param } from "scene";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ParamRow } from "./ParamRow";
import { currentValue, formatResult, type ParamResult } from "./params-values";

export interface ParamsProps {
  params: readonly Param[];
  values: Readonly<Record<string, number>>;
  // The first result is the one to remember and is highlighted; the others are listed below it.
  results: readonly ParamResult[];
  onChange(id: string, value: number): void;
  onReset(): void;
  onAdjustingChange?(adjusting: boolean): void;
  className?: string;
}

function ResultSymbol({ result }: { result: ParamResult }) {
  return result.symbol === undefined ? null : <i className="pr-2">{result.symbol}</i>;
}

function Results({ results, language }: { results: readonly ParamResult[]; language: Language }) {
  const t = useTranslations("Params");
  const id = useId();
  const [main, ...others] = results;
  if (main === undefined) return null;

  const show = (result: ParamResult): string => {
    const text = formatResult(result, language);
    return result.unit === "" ? text : t("withUnit", { value: text, unit: result.unit });
  };

  return (
    <div role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-caption border-b border-ink pb-2">
        {t("results.title")}
      </h3>
      <output className="mt-4 block">
        <span className="text-body block text-ink-soft">
          <ResultSymbol result={main} />
          {main.label}
        </span>
        <span className="text-lead mt-1 box-decoration-clone bg-role-result px-2 py-1 font-mono tabular-nums text-ink dark:text-surface">
          {show(main)}
        </span>
      </output>
      {others.length > 0 && (
        <ul className="mt-6">
          {others.map((result) => (
            <li
              key={result.id}
              className="flex items-baseline justify-between gap-4 border-b border-rule py-2"
            >
              <span className="text-body min-w-0">
                <ResultSymbol result={result} />
                {result.label}
              </span>
              <span className="text-data shrink-0">{show(result)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Params({
  params,
  values,
  results,
  onChange,
  onReset,
  onAdjustingChange,
  className,
}: ParamsProps) {
  const t = useTranslations("Params");
  const locale = useLocale();
  const titleId = useId();
  const [notice, setNotice] = useState("");

  if (params.length === 0) return null;

  const language: Language = locale === "en" ? "en" : "fr";

  return (
    <section aria-labelledby={titleId} className={cn("@container", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6">
        <h2 id={titleId} className="text-title">
          {t("title")}
        </h2>
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setNotice(t("resetDone"));
            onReset();
          }}
        >
          {t("reset")}
        </Button>
      </div>
      <div
        className={cn(
          "mt-4 grid gap-x-12 gap-y-8",
          results.length > 0 && "@3xl:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]",
        )}
      >
        <ul className="border-t border-ink">
          {params.map((param) => (
            <ParamRow
              key={param.id}
              param={param}
              value={currentValue(param, values)}
              language={language}
              onChange={(id, value) => {
                setNotice("");
                onChange(id, value);
              }}
              onAdjustingChange={onAdjustingChange}
              onNotice={setNotice}
            />
          ))}
        </ul>
        {results.length > 0 && <Results results={results} language={language} />}
      </div>
      <p role="status" className="sr-only">
        {notice}
      </p>
    </section>
  );
}
