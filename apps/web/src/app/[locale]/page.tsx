import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AskSentence } from "@/components/ask/AskSentence";
import { Preferences } from "@/components/ask/Preferences";
import { Sommaire } from "@/components/ask/Sommaire";
import { localeFromParams } from "@/i18n/params";
import { listReferences } from "@/server/reference";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Ask" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

async function referencesOf(locale: Awaited<ReturnType<typeof localeFromParams>>) {
  try {
    return await listReferences(locale);
  } catch (error) {
    console.error("Reference explanations are unreadable.", error);
    return [];
  }
}

export default async function HomePage({ params }: Props) {
  const locale = await localeFromParams(params);
  const references = await referencesOf(locale);
  const common = await getTranslations({ locale, namespace: "Common" });
  const t = await getTranslations({ locale, namespace: "Ask" });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="page-width border-b border-ink">
        <h1 className="text-caption flex min-h-14 items-center">{common("productName")}</h1>
      </header>

      <main id="content" className="page-width flex-1 pt-8 pb-16 lg:pt-24">
        <div className="grid gap-x-6 lg:grid-cols-12">
          <p className="text-caption mb-6 text-ink-faint lg:col-span-2 lg:mb-0 lg:pt-4">
            {t("questionLegend")}
          </p>
          <div className="min-w-0 lg:col-span-10">
            <AskSentence />
            <div className="mt-12 border-t border-rule pt-6">
              <Preferences />
            </div>
            <div className="mt-12 border-t border-rule pt-8">
              <Sommaire entries={references} />
            </div>
          </div>
        </div>
      </main>

      <footer className="page-width border-t border-rule py-6">
        <div className="grid gap-x-6 gap-y-2 lg:grid-cols-12">
          <p className="text-caption text-ink-faint lg:col-span-2">{t("colophonLabel")}</p>
          <p className="text-body max-w-prose text-ink-soft italic lg:col-span-10">
            {t("colophon")}
          </p>
        </div>
      </footer>
    </div>
  );
}
