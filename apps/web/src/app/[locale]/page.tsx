import { getTranslations } from "next-intl/server";
import { localeFromParams } from "@/i18n/params";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Common" });

  return (
    <main id="content" className="page-width py-16">
      <h1 className="font-display text-display-l">{t("productName")}</h1>
    </main>
  );
}
