import { cn } from "@/lib/utils";
import { type NumberedCut, blockRect, cutName } from "@/lib/cut-review";

/**
 * One cut on the timeline (spec 0011, AC-1, AC-2): a button that puts the cut back or removes
 * it again. `aria-pressed` is true when the cut is kept. The visible block is at least 12 px
 * wide, the hit area at least 24 by 44 px, both centred on the cut.
 */
export function CutBlock({
  cut,
  applied,
  durationMs,
  widthPx,
  disabled,
  onPress,
}: {
  readonly cut: NumberedCut;
  readonly applied: boolean;
  readonly durationMs: number;
  readonly widthPx: number;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const r = blockRect(cut, durationMs, widthPx);
  return (
    <button
      type="button"
      aria-pressed={!applied}
      aria-label={cutName(cut, applied)}
      disabled={disabled}
      onClick={onPress}
      style={{ left: r.hitLeft, width: r.hitWidth }}
      className="absolute inset-y-0 min-h-11 cursor-pointer rounded-sm disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        style={{ left: r.left - r.hitLeft, width: r.width }}
        className={cn(
          "absolute inset-y-1 rounded-sm border",
          applied
            ? "border-stage-accent [background-image:repeating-linear-gradient(135deg,var(--stage-accent)_0_2px,transparent_2px_6px)]"
            : "border-dashed border-stage-text-muted bg-transparent",
        )}
      />
    </button>
  );
}
