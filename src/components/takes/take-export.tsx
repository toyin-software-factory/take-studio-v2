"use client";

import { Captions, Download, FileText, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TakeDetail } from "@/lib/take-api";
import { expiryNote, formatClock } from "@/lib/take-display";
import type { useTranscript } from "./use-transcript";
import { useTakeDownloads } from "./use-take-downloads";

type FileRowProps = {
  readonly icon: typeof Film;
  readonly name: string;
  readonly kind: string;
  readonly meta?: string;
  readonly action: React.ReactNode;
};

/** One exportable file: icon, name, a type chip, a short line, and its save action. */
function FileRow({ icon, name, kind, meta, action }: FileRowProps) {
  return (
    <li className="flex items-center gap-3 py-3">
      <Icon icon={icon} className="text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-medium">{name}</p>
        <p className="mono flex items-center gap-2 text-caption text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5">{kind}</span>
          {meta ? <span>{meta}</span> : null}
        </p>
      </div>
      {action}
    </li>
  );
}

/**
 * The Export tab (design.md §4b): the files this take gives you, each with a type chip and a
 * save action, and the retention line. The edited video and the original go through the same
 * download links as the summary row; captions and transcript text are the transcript's own
 * download routes, shown once there are words. Save buttons have names of their own so they
 * never clash with the summary row's "Download" and "Download original".
 */
export function TakeExport({
  detail,
  transcript,
}: {
  readonly detail: TakeDetail;
  readonly transcript: ReturnType<typeof useTranscript>;
}) {
  const { take, latestRender } = detail;
  const { pending, download } = useTakeDownloads(take.id);
  const expiry = expiryNote(take.videoExpiresAt, take.expired, new Date());
  const view = transcript.view;
  const words = view?.state === "ready" && (view.paragraphs?.length ?? 0) > 0;
  const query = view?.version ? `?v=${encodeURIComponent(view.version)}` : "";
  const gone = take.expired || take.status === "expired";

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border">
        {gone ? null : (
          <>
            <FileRow
              icon={Film}
              name="Edited video"
              kind="MP4"
              meta={latestRender?.durationMs ? formatClock(latestRender.durationMs) : undefined}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === "download"}
                  aria-label="Save edited video"
                  onClick={() => void download("download")}
                >
                  <Icon icon={Download} size="badge" />
                  Save
                </Button>
              }
            />
            <FileRow
              icon={Film}
              name="Original video"
              kind={take.container.toUpperCase()}
              meta={take.durationMs ? formatClock(take.durationMs) : undefined}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === "original"}
                  aria-label="Save original video"
                  onClick={() => void download("original")}
                >
                  <Icon icon={Download} size="badge" />
                  Save
                </Button>
              }
            />
          </>
        )}
        {words ? (
          <>
            <FileRow
              icon={Captions}
              name="Captions"
              kind="SRT"
              action={
                <Button asChild size="sm" variant="secondary">
                  <a
                    href={`/api/takes/${take.id}/transcript/srt${query}`}
                    download
                    aria-label="Save captions (SRT)"
                  >
                    <Icon icon={Download} size="badge" />
                    Save
                  </a>
                </Button>
              }
            />
            <FileRow
              icon={FileText}
              name="Transcript"
              kind="TXT"
              action={
                <Button asChild size="sm" variant="secondary">
                  <a
                    href={`/api/takes/${take.id}/transcript/txt${query}`}
                    download
                    aria-label="Save transcript (TXT)"
                  >
                    <Icon icon={Download} size="badge" />
                    Save
                  </a>
                </Button>
              }
            />
          </>
        ) : null}
      </ul>
      {gone ? (
        <p className="text-small text-muted-foreground">The video files have expired.</p>
      ) : null}
      {!words && !gone ? (
        <p className="text-small text-muted-foreground">
          Captions and the transcript text appear here once the transcript is ready.
        </p>
      ) : null}
      {expiry ? <p className="text-small text-muted-foreground">{expiry}</p> : null}
    </div>
  );
}
