import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "text-control inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap transition-transform duration-instant select-none active:translate-y-px disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-ink text-surface underline-offset-3 hover:underline disabled:bg-ink-faint",
        secondary:
          "border border-ink bg-transparent text-ink hover:bg-surface-sunk disabled:border-ink-faint disabled:text-ink-faint",
        ghost: "bg-transparent text-ink hover:bg-surface-sunk disabled:text-ink-faint",
        link: "text-ink underline decoration-1 underline-offset-3 hover:decoration-2 disabled:text-ink-faint",
      },
      size: {
        default: "h-12 px-6",
        sm: "h-11 px-4",
        icon: "touch-target",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-11 px-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
