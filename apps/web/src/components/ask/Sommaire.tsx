import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Level } from "scene";
import { Link } from "@/i18n/navigation";

export const REFERENCE_SUBJECTS = [
  "maths",
  "physics",
  "chemistry",
  "biology",
  "cs",
  "economics",
] as const;

export type ReferenceSubject = (typeof REFERENCE_SUBJECTS)[number];

export interface ReferenceEntry {
  slug: string;
  subject: ReferenceSubject;
  title: string;
  reference_level: Level;
  explanation_id: string;
}

interface SommaireProps {
  entries: readonly ReferenceEntry[];
}

export function Sommaire({ entries }: SommaireProps) {
  const t = useTranslations("Ask.sommaire");
  const tLevel = useTranslations("Level");
  const id = useId();

  const groups = REFERENCE_SUBJECTS.map((subject) => ({
    subject,
    items: entries.filter((entry) => entry.subject === subject),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-title">
        {t("title")}
      </h2>
      <p className="text-body mt-3 max-w-prose text-ink-soft">{t("intro")}</p>
      <div className="mt-8 gap-x-6 md:columns-2">
        {groups.map(({ subject, items }) => (
          <section
            key={subject}
            aria-labelledby={`${id}-${subject}`}
            className="mb-10 break-inside-avoid"
          >
            <h3 id={`${id}-${subject}`} className="text-caption border-b border-ink pb-2">
              {t(`subjects.${subject}`)}
            </h3>
            <ul>
              {items.map((entry) => (
                <li key={entry.explanation_id} className="border-b border-rule">
                  <Link
                    href={`/e/${encodeURIComponent(entry.explanation_id)}`}
                    className="group touch-target flex items-baseline gap-x-3 py-2.5"
                  >
                    <span className="text-body min-w-0 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-3">
                      {entry.title}
                    </span>{" "}
                    <span
                      aria-hidden
                      className="min-w-4 flex-1 border-b-2 border-dotted border-ink-faint"
                    />
                    <span className="text-data shrink-0 text-ink-soft">
                      <span className="sr-only">{t("levelIntro")} </span>
                      {tLevel(entry.reference_level)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
