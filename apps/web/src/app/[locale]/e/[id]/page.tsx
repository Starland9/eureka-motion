import { ExplanationView } from "@/components/explanation/ExplanationView";
import { localeFromParams } from "@/i18n/params";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function ExplanationPage({ params }: Props) {
  await localeFromParams(params);
  const { id } = await params;
  return <ExplanationView key={id} id={id} />;
}
