"use client";

import { ArrowRight, Download, RotateCcw, TriangleAlert } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { RecordedTake } from "@/lib/recorder-state";
import { formatClock } from "@/lib/take-display";
import type { UploadState } from "@/components/takes/use-upload";

/** The glass panel beside the take: the heading, the three actions or the upload, and a note. */
export function ReviewPanel({
  take,
  url,
  failure,
  upload,
  onUse,
  onAgain,
  onCancel,
}: {
  readonly take: RecordedTake;
  readonly url: string | null;
  readonly failure: string | null;
  readonly upload: UploadState | null;
  readonly onUse: () => void;
  readonly onAgain: () => void;
  readonly onCancel: () => void;
}) {
  const sending = upload !== null;
  return (
    <section className="rvw-panel" aria-label="Your take">
      <p className="rvw-eyebrow">Your take</p>
      <h3 data-check="s2-stage-heading-2">
        <span className="rvw-muted">{formatClock(take.durationMs)} recorded.</span>{" "}
        {sending
          ? "Sending it now."
          : failure
            ? "Your recording is still on this device."
            : "Nothing has left this device yet."}
      </h3>
      {take.note ? (
        <p role="status" className="rvw-alert">
          <Icon icon={TriangleAlert} />
          <span>
            <strong>Recording stopped early</strong> {take.note}
          </span>
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="rvw-alert">
          <Icon icon={TriangleAlert} />
          <span>
            <strong>This take wasn&apos;t uploaded</strong> {failure} Your recording is still here.
          </span>
        </p>
      ) : null}
      {upload ? (
        <Sending upload={upload} onCancel={onCancel} />
      ) : (
        <div className="rvw-acts">
          <button type="button" className="rec-split" onClick={onUse}>
            <span className="rec-split__label">{failure ? "Try again" : "Use this take"}</span>
            <span className="rec-split__icon" aria-hidden="true">
              <ArrowRight size={18} strokeWidth={1.5} />
            </span>
          </button>
          <button type="button" className="rvw-ghost" onClick={onAgain}>
            <Icon icon={RotateCcw} /> Record again
          </button>
          {url ? (
            <a className="rvw-ghost" href={url} download={take.fileName}>
              <Icon icon={Download} /> Save to device
            </a>
          ) : null}
        </div>
      )}
      <p className="rvw-note">
        Use this take: we cut the pauses, add your studio and write the captions. It opens on its
        take page.
      </p>
    </section>
  );
}

function Sending({
  upload,
  onCancel,
}: {
  readonly upload: UploadState;
  readonly onCancel: () => void;
}) {
  const completing = upload.kind === "completing";
  // Before the first progress event the file is on its way but there is no number yet.
  const percent = upload.kind === "uploading" ? upload.percent : null;
  return (
    <div className="rvw-up">
      <div
        role="progressbar"
        aria-label={completing ? "Finishing upload" : "Upload progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="rvw-bar"
        data-indeterminate={percent === null}
      >
        <i style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <p className="rvw-note" aria-live="polite">
        {completing ? "Finishing upload…" : "Uploading. Keep this tab open."}
        {percent === null ? null : (
          <span className="mono" aria-hidden="true">
            {" "}
            {percent}%
          </span>
        )}
      </p>
      {completing ? null : (
        <button type="button" className="rvw-ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
