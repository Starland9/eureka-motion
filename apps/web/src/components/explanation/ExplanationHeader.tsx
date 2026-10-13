import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ThemeSwitch } from "./ThemeSwitch";

const LINK =
  "touch-target text-caption inline-flex items-center underline-offset-8 hover:underline";

export function ExplanationHeader() {
  const common = useTranslations("Common");
  const t = useTranslations("Explanation.header");

  return (
    <header className="page-width border-b border-ink">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6">
        <Link href="/" className={LINK}>
          {common("productName")}
        </Link>
        <div className="flex flex-wrap items-center gap-x-4">
          <Link href="/" className={LINK}>
            {t("newQuestion")}
          </Link>
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
