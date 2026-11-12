"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TakeDetail } from "@/lib/take-api";
import { TAKE_NOTES, removedNote } from "@/lib/take-display";
import { useTakeDownloads } from "./use-take-downloads";

/**
 * The summary row under the stage when a take is ready (AC-7, AC-9; design.md §4b): "Removed
 * m:ss of pauses" or the AC-7 note on the left, "Download" (the primary pill, `<slug>-trimmed.mp4`
 * or the original when nothing was trimmed) and "Download original" (the ghost pill) on the right.
 */
export function TakeResult({ detail }: { readonly detail: TakeDetail }) {
  const { pending, download } = useTakeDownloads(detail.take.id);
  const { take, note, removedMs } = detail;
  if (take.status !== "ready" || take.expired) return null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-medium">{note ? TAKE_NOTES[note] : removedNote(removedMs)}</p>
      <div className="flex flex-wrap gap-2">
        <Button loading={pending === "download"} onClick={() => void download("download")}>
          <Icon icon={Download} size="badge" />
          Download
        </Button>
        <Button
          variant="secondary"
          loading={pending === "original"}
          onClick={() => void download("original")}
        >
          Download original
        </Button>
      </div>
    </div>
  );
}
