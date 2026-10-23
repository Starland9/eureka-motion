import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function VisitorAsk({ className }: { className?: string }) {
  const t = useTranslations("Share");

  return (
    <div
      data-slot="visitor-ask"
      className={cn("flex flex-col gap-2 border-t border-ink pt-8", className)}
    >
      <p className="text-lead max-w-prose text-pretty">{t("visitorLead")}</p>
      <Link href="/" className={cn(buttonVariants({ variant: "link" }), "self-start")}>
        {t("ask")}
      </Link>
    </div>
  );
}
