import { CircleCheck, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sceneNumberLabel } from "./quiz-logic";

export function VerdictIcon({ right, className }: { right: boolean; className?: string }) {
  const Icon = right ? CircleCheck : CircleX;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-5 shrink-0",
        right ? "text-role-valid" : "text-role-action-text",
        className,
      )}
    />
  );
}

export function ReviewLink({
  sceneNumber,
  onReview,
  className,
}: {
  sceneNumber: number | undefined;
  onReview(): void;
  className?: string;
}) {
  const t = useTranslations("Quiz");
  return (
    <Button type="button" variant="link" onClick={onReview} className={className}>
      {sceneNumber === undefined
        ? t("reviewPlain")
        : t("review", { number: sceneNumberLabel(sceneNumber) })}
    </Button>
  );
}
