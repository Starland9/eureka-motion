"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const TOAST_DURATION_MS = 4000;

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-left"
      expand
      duration={TOAST_DURATION_MS}
      icons={{
        success: <CheckIcon className="size-5" aria-hidden />,
        error: <XIcon className="size-5" aria-hidden />,
        info: <></>,
        warning: <></>,
        loading: <></>,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "text-body flex w-(--width) items-start gap-3 border border-l-4 border-ink bg-surface-raised p-4 text-ink transition-[transform,opacity]!",
          icon: "mt-0.5 flex shrink-0 empty:hidden",
          content: "flex min-w-0 flex-1 flex-col gap-1",
          title: "text-body",
          description: "text-body text-ink-soft",
          success: "border-l-role-valid",
          error: "border-l-role-action",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
