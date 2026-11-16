import { DROP_COPY, percentLabel } from "@/lib/guest-drop";
import type { DropState } from "./use-guest-drop";

/**
 * The upload row (spec 0023 AC-1, AC-13): file name, a bar with a real progressbar role and a
 * Cancel button. The page announces coarse steps through the card's one live region, not here.
 */
export function DropProgress({
  state,
  onCancel,
}: {
  readonly state: Extract<DropState, { kind: "checking" | "uploading" | "done" }>;
  readonly onCancel: () => void;
}) {
  const percent = state.kind === "uploading" ? state.percent : state.kind === "done" ? 100 : 0;
  const label =
    state.kind === "done"
      ? DROP_COPY.done
      : state.kind === "checking"
        ? "Getting ready."
        : DROP_COPY.uploading;
  return (
    <div className="h-drop-progress">
      <p className="h-drop-file">{state.fileName}</p>
      <div
        className="h-drop-bar"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={percentLabel(percent)}
      >
        <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <div className="h-drop-row">
        <p className="h-drop-muted">
          {label} {state.kind === "uploading" ? percentLabel(percent) : ""}
        </p>
        {state.kind === "done" ? null : (
          <button type="button" className="h-drop-link" onClick={onCancel}>
            {DROP_COPY.cancel}
          </button>
        )}
      </div>
    </div>
  );
}
