import { LEVEL_STEPS } from "@/lib/recorder-devices";
import type { Level } from "./use-level";

/** A segmented microphone level (AC-9: the meter is also a word, "Good", for a screen reader). */
export function LevelMeter({ level }: { readonly level: Level }) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="img"
        aria-label={`Microphone level: ${level.label}`}
        className="flex h-2 flex-1 gap-1"
      >
        {Array.from({ length: LEVEL_STEPS }, (_, i) => (
          <span
            key={i}
            className={`h-full flex-1 rounded-sm ${i < level.lit ? "bg-success" : "bg-border"}`}
          />
        ))}
      </div>
      <span className="w-24 text-small text-muted-foreground">{level.label}</span>
    </div>
  );
}
