import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DemoPage } from "@/components/demo/DemoPage";
import { localeFromParams } from "@/i18n/params";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Demo" });
  return { title: t("metaTitle"), description: t("intro") };
}

export default async function DemoRoute({ params }: Props) {
  await localeFromParams(params);
  return <DemoPage />;
}
