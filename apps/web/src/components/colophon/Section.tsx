import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("min-w-0", className)}>
      <h3 id={id} className="text-caption border-t border-rule pt-3 pb-4">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Field({
  label,
  lang,
  data = false,
  className,
  children,
}: {
  label: string;
  lang?: string;
  data?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-caption text-ink-faint">{label}</dt>
      <dd lang={lang} className={cn("mt-1 wrap-anywhere", data ? "text-data" : "text-body")}>
        {children}
      </dd>
    </div>
  );
}

export function dataSpan(chunks: ReactNode): ReactNode {
  return <span className="text-data">{chunks}</span>;
}
