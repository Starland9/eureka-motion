import { useTranslations } from "next-intl";
import type { Language, Scene } from "scene";
import { narrationOf } from "./rows";
import { dataSpan, Section } from "./Section";

export function NarrationSection({
  scenes,
  language,
  className,
}: {
  scenes: readonly Scene[];
  language: Language;
  className?: string;
}) {
  const t = useTranslations("Colophon");
  return (
    <Section title={t("narration.title")} className={className}>
      <dl className="lg:columns-2 lg:gap-x-6">
        {scenes.map((scene) => (
          <div key={scene.id} className="break-inside-avoid pb-6">
            <dt>
              <span className="text-caption text-ink-faint">
                {t.rich("sceneLabel", { number: scene.index + 1, n: dataSpan })}
              </span>{" "}
              <span lang={language}>{scene.title}</span>
            </dt>
            <dd lang={language} className="mt-1 max-w-prose">
              {narrationOf(scene)}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
