"use client";

import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      className={cn(
        "touch-target flex w-full cursor-pointer items-center justify-between gap-4 text-left after:font-mono after:content-['+'] data-open:after:content-['−']",
        className,
      )}
      {...props}
    />
  );
}

function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        "data-open:animate-in data-open:duration-base data-open:ease-arrive data-open:fade-in-0 data-closed:animate-out data-closed:duration-leave-base data-closed:ease-leave data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
