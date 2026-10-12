import { useTranslations } from "next-intl";
import type { Language } from "scene";
import type { ExplanationState } from "@/components/explanation/types";
import { Formula } from "./Formula";
import { Field, Section } from "./Section";

export function PlanSection({
  plan,
  language,
}: {
  plan: NonNullable<ExplanationState["plan"]>;
  language: Language;
}) {
  const t = useTranslations("Colophon");
  return (
    <Section title={t("plan.title")}>
      <dl className="space-y-5">
        <Field label={t("plan.objective")} lang={language}>
          {plan.objective}
        </Field>
        {plan.prerequisites.length > 0 ? (
          <Field label={t("plan.prerequisites")} lang={language}>
            <ul className="list-disc space-y-1 pl-5 marker:text-ink-faint">
              {plan.prerequisites.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Field>
        ) : null}
        <Field label={t("plan.analogy")} lang={language}>
          <p className="italic">{plan.analogy.name}</p>
          <p className="mt-1 text-ink-soft">{plan.analogy.mapping}</p>
        </Field>
        <Field label={t("plan.keyRule")} lang={language}>
          <p>{plan.key_rule.statement}</p>
          {plan.key_rule.formula ? <Formula tex={plan.key_rule.formula} /> : null}
        </Field>
        <Field label={t("plan.steps")}>
          <ol className="space-y-3">
            {plan.steps.map((step, index) => (
              <li key={index} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
                <span className="text-data text-ink-faint">{index + 1}</span>
                <div>
                  <p className="text-caption text-ink-faint">{t(`roles.${step.role}`)}</p>
                  <p lang={language}>{step.intent}</p>
                </div>
              </li>
            ))}
          </ol>
        </Field>
      </dl>
    </Section>
  );
}
