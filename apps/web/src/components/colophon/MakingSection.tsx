import { useFormatter, useTranslations } from "next-intl";
import type { ExplanationState } from "@/components/explanation/types";
import { secondsOf } from "./rows";
import { dataSpan, Field, Section } from "./Section";

export function MakingSection({
  generator,
  timings,
  review,
  className,
}: {
  generator: ExplanationState["generator"];
  timings: ExplanationState["timings"];
  review?: { reviewer: string; date: string };
  className?: string;
}) {
  const t = useTranslations("Colophon");
  const format = useFormatter();
  const reviewDateText = (raw: string): string => {
    const date = new Date(raw);
    return Number.isNaN(date.getTime())
      ? raw
      : format.dateTime(date, { dateStyle: "long", timeZone: "UTC" });
  };
  const seconds = (value: number): string =>
    format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const firstScene = secondsOf(timings, "first_scene");
  const total = secondsOf(timings, "total");
  if (!generator && firstScene === null && total === null && !review) return null;

  return (
    <Section title={t("making.title")} className={className}>
      <dl className="flex flex-wrap gap-x-10 gap-y-5">
        {generator ? (
          <>
            <Field label={t("making.model")} data>
              {generator.model}
            </Field>
            <Field label={t("making.provider")} data>
              {generator.provider}
            </Field>
          </>
        ) : null}
        {firstScene !== null ? (
          <Field label={t("making.firstScene")}>
            {t.rich("making.seconds", { value: seconds(firstScene), n: dataSpan })}
          </Field>
        ) : null}
        {total !== null ? (
          <Field label={t("making.total")}>
            {t.rich("making.seconds", { value: seconds(total), n: dataSpan })}
          </Field>
        ) : null}
      </dl>
      {review ? (
        <p className="mt-5 wrap-anywhere">
          {t.rich("making.reviewed", {
            reviewer: review.reviewer,
            date: reviewDateText(review.date),
            d: dataSpan,
          })}
        </p>
      ) : null}
    </Section>
  );
}
