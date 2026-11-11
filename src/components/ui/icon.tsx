import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Icon sizes from design.md: badges and inputs, UI, stage controls, empty states. */
export const iconSizes = { badge: 16, ui: 20, stage: 24, empty: 40 } as const;

export type IconSize = keyof typeof iconSizes;

type IconProps = {
  /** A Lucide icon, imported one by one (`import { Check } from "lucide-react"`). */
  readonly icon: LucideIcon;
  readonly size?: IconSize;
  /** Give a label only when the icon carries meaning on its own; otherwise it is hidden. */
  readonly label?: string;
  readonly className?: string;
};

/** Shared icon wrapper: stroke 1.5, inherits `currentColor`, decorative unless labelled. */
export function Icon({ icon: Glyph, size = "ui", label, className }: IconProps) {
  return (
    <Glyph
      size={iconSizes[size]}
      strokeWidth={1.5}
      className={cn("shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
