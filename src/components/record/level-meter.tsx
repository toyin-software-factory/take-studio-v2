import { LEVEL_STEPS } from "@/lib/recorder-devices";
import type { Level } from "./use-level";

/** A segmented microphone level (AC-9: the meter is also a word, "Good", for a screen reader). */
export function LevelMeter({ level }: { readonly level: Level }) {
  return (
    <div className="flex w-full items-center gap-3">
      <div
        role="img"
        aria-label={`Microphone level: ${level.label}`}
        className="flex h-2 min-w-0 flex-1 gap-1"
      >
        {Array.from({ length: LEVEL_STEPS }, (_, i) => (
          <span
            key={i}
            className={`h-full min-w-0 flex-1 rounded-sm ${i < level.lit ? "bg-[var(--color-accent)]" : "bg-[var(--color-on-dark-20)]"}`}
          />
        ))}
      </div>
      <span role="status" className="w-20 text-small text-[var(--color-on-dark-75)]">
        {level.label}
      </span>
    </div>
  );
}
