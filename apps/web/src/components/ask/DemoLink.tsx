import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function DemoLink() {
  const t = useTranslations("Ask");

  return (
    <div className="mt-2">
      <Link href="/demo" className={cn(buttonVariants({ variant: "link" }))}>
        {t("demoLink")}
      </Link>
    </div>
  );
}
