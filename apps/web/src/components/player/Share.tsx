"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const FEEDBACK_MS = 4000;

type Outcome = "copied" | "failed";

function copyBySelection(text: string): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.opacity = "0";
  document.body.append(field);
  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch {
    // The browser refuses the command; the caller reports it.
  }
  field.remove();
  previous?.focus({ preventScroll: true });
  return copied;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyBySelection(text);
  }
}

export function Share({ path, className }: { path: string | null; className?: string }) {
  const t = useTranslations("Share");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  if (path === null) return null;

  async function copy(target: string) {
    const copied = await copyText(new URL(target, window.location.origin).href);
    if (!mounted.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setOutcome(copied ? "copied" : "failed");
    timer.current = setTimeout(() => {
      timer.current = null;
      setOutcome(null);
    }, FEEDBACK_MS);
  }

  return (
    <div data-slot="share" className={cn("flex flex-col", className)}>
      <Button type="button" variant="link" className="self-start" onClick={() => void copy(path)}>
        {t("copy")}
      </Button>
      <p role="status" className="text-body min-h-[1lh] text-ink-soft">
        {outcome === "copied" ? t("copied") : null}
      </p>
      <div role="alert">
        {outcome === "failed" ? (
          <p className="text-body max-w-prose border-l-2 border-role-action py-1 pl-3">
            {t("copyFailed")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
