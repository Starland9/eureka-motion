import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "text-body touch-target block w-full min-w-0 border-b-2 border-ink bg-transparent px-0 py-2 text-ink placeholder:text-ink-faint placeholder:italic disabled:cursor-not-allowed disabled:border-ink-faint disabled:text-ink-faint aria-invalid:border-role-action",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
