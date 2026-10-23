"use client";

import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { SHARE_RETENTION_DAYS } from "@/server/pipeline/ports";
import { ExplanationHeader } from "./ExplanationHeader";

export function GonePage({ kind }: { kind: "missing" | "expired" }) {
  const t = useTranslations("Share");
  const explanation = useTranslations("Explanation");
  const product = useTranslations("Common")("productName");
  const title = t(`${kind}.title`);

  return (
    <div className="flex min-h-dvh flex-col">
      <title>{explanation("documentTitle", { title, product })}</title>
      <ExplanationHeader />
      <main id="content" className="page-width flex-1 pt-8 pb-16 lg:pt-12">
        <div className="grid gap-x-6 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
            <h1 className="text-title text-balance break-words sm:text-display-m">{title}</h1>
            <p className="text-lead max-w-prose text-pretty">
              {t(`${kind}.lead`, { days: SHARE_RETENTION_DAYS })}
            </p>
            <p className="text-body max-w-prose text-pretty text-ink-soft">{t(`${kind}.next`)}</p>
            <Link href="/" className={cn(buttonVariants({ variant: "link" }), "self-start")}>
              {t("ask")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
