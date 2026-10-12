"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const MAJOR_TICK_EVERY = 5;

function Slider({
  className,
  min = 0,
  max = 100,
  graduations = 10,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-valuetext": ariaValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  graduations?: number;
}) {
  const thumbCount = (props.value ?? props.defaultValue ?? [min]).length;

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      min={min}
      max={max}
      className={cn(
        "relative flex h-11 w-full touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:text-ink-faint",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-2 top-[calc(50%+1px)] flex items-start justify-between"
      >
        {Array.from({ length: graduations + 1 }, (_, index) => (
          <span
            key={index}
            className={cn("w-px bg-current", index % MAJOR_TICK_EVERY === 0 ? "h-3" : "h-2")}
          />
        ))}
      </span>
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative mx-2 h-0.5 grow bg-current"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-role-quantity data-disabled:bg-ink-faint"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuetext={ariaValueText}
          className="block size-4 shrink-0 border-2 border-current bg-surface-raised select-none hover:bg-surface-sunk active:bg-current disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
