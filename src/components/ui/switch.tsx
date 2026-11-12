"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Switch as SwitchPrimitive } from "radix-ui";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative pointer-coarse:after:absolute pointer-coarse:after:-inset-3 inline-flex cursor-pointer shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:data-[state=checked]:bg-disabled-fg disabled:data-[state=unchecked]:bg-disabled-bg data-[size=default]:h-6 data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-card shadow-card ring-0 in-[.stage]:bg-stage-text transition-transform group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-0.5 ",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
