import { useFormatter, useTranslations } from "next-intl";
import type { Language } from "scene";
import { cn } from "@/lib/utils";
import { checkKey, type CheckSets, type RowStatus, type VerificationRow } from "./rows";
import { dataSpan, Field, Section } from "./Section";

const STATUS_TONE: Record<RowStatus, string> = {
  validated: "text-role-valid",
  corrected: "text-ink",
  dropped: "text-role-action-text",
  pending: "text-ink-soft",
};

function Row({ row, language }: { row: VerificationRow; language: Language }) {
  const t = useTranslations("Colophon");
  const isPlan = row.index === null;
  const number = row.index === null ? null : row.index + 1;
  return (
    <li
      data-verdict={row.target}
      data-status={row.status}
      className="border-b border-rule py-3 text-body"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 basis-56 wrap-anywhere">
          <span className="text-caption text-ink-faint">
            {number === null
              ? t("verification.plan")
              : t.rich("sceneLabel", { number, n: dataSpan })}
          </span>{" "}
          {row.title ? (
            <span lang={language}>{row.title}</span>
          ) : row.role ? (
            <span>{t(`roles.${row.role}`)}</span>
          ) : null}
        </p>
        <p className="ml-auto flex flex-wrap items-baseline justify-end gap-x-3 text-caption">
          <span className={cn(STATUS_TONE[row.status])}>
            {t(`verification.status.${row.status}`, { kind: isPlan ? "plan" : "scene" })}
          </span>
          {row.attempts > 1 ? (
            <span className="text-ink-soft">
              {t.rich("verification.attempts", { count: row.attempts, n: dataSpan })}
            </span>
          ) : null}
        </p>
      </div>
      {row.reason ? (
        <p lang={language} className="mt-1 wrap-anywhere text-ink-soft">
          {row.reason}
        </p>
      ) : null}
    </li>
  );
}

export function VerificationSection({
  rows,
  checks,
  language,
}: {
  rows: readonly VerificationRow[];
  checks: CheckSets;
  language: Language;
}) {
  const t = useTranslations("Colophon");
  const format = useFormatter();
  const names = (list: readonly string[]): string =>
    format.list(
      list.map((check) => {
        const key = checkKey(check);
        return key ? t(`verification.checks.${key}`) : check;
      }),
      { type: "conjunction" },
    );
  return (
    <Section title={t("verification.title")}>
      {checks.plan.length > 0 || checks.scenes.length > 0 ? (
        <dl className="mb-5 space-y-3">
          {checks.plan.length > 0 ? (
            <Field label={t("verification.checksPlan")}>{names(checks.plan)}</Field>
          ) : null}
          {checks.scenes.length > 0 ? (
            <Field label={t("verification.checksScenes")}>{names(checks.scenes)}</Field>
          ) : null}
        </dl>
      ) : null}
      <ol>
        {rows.map((row) => (
          <Row key={row.target} row={row} language={language} />
        ))}
      </ol>
    </Section>
  );
}
