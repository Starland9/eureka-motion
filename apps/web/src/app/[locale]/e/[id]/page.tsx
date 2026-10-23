import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExplanationView } from "@/components/explanation/ExplanationView";
import { GonePage } from "@/components/explanation/GonePage";
import { localeFromParams } from "@/i18n/params";
import { checkAvailability } from "./availability";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const { id } = await params;
  if ((await checkAvailability(id)) !== "expired") return {};
  const share = await getTranslations({ locale, namespace: "Share" });
  const explanation = await getTranslations({ locale, namespace: "Explanation" });
  const common = await getTranslations({ locale, namespace: "Common" });
  return {
    title: explanation("documentTitle", {
      title: share("expired.title"),
      product: common("productName"),
    }),
    robots: { index: false },
  };
}

export default async function ExplanationPage({ params }: Props) {
  await localeFromParams(params);
  const { id } = await params;
  const availability = await checkAvailability(id);
  if (availability === "missing") notFound();
  if (availability === "expired") return <GonePage kind="expired" />;
  return <ExplanationView key={id} id={id} />;
}
