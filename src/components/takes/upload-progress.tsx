"use client";

import { FileVideo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import type { UploadState } from "./use-upload";

/**
 * The upload in progress (design.md Upload dropzone and Progress): file name, percent in mono,
 * a progress bar and Cancel; then "Finishing upload…" with an indeterminate bar while the
 * server confirms. Progress is announced politely.
 */
export function UploadProgress({
  state,
  onCancel,
}: {
  readonly state: UploadState;
  readonly onCancel: () => void;
}) {
  if (state.kind !== "uploading" && state.kind !== "completing") return null;
  const completing = state.kind === "completing";
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface px-4 py-6 shadow-card sm:px-6">
      <div className="flex items-center gap-3">
        <Icon icon={FileVideo} className="text-text-muted" />
        <p className="min-w-0 flex-1 truncate font-medium" title={state.fileName}>
          {state.fileName}
        </p>
        {completing ? null : (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <Progress
        aria-label={completing ? "Finishing upload" : "Upload progress"}
        value={completing ? undefined : state.percent}
      />
      <div className="flex items-center justify-between gap-3 text-small text-text-muted">
        {/* Only the phase is announced; the percent would be read out on every change. */}
        <p aria-live="polite">
          {completing ? "Finishing upload…" : "Uploading. Keep this tab open."}
        </p>
        {completing ? null : (
          <span className="mono" aria-hidden="true">
            {state.percent}%
          </span>
        )}
      </div>
    </div>
  );
}
