import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Notice({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "alert";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "text-body flex items-start gap-3 border-l-2 py-1 pl-3 text-ink-soft",
        tone === "alert" ? "border-role-action" : "border-ink",
        className,
      )}
    >
      {tone === "alert" ? (
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-role-action-text" />
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
