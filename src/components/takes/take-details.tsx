"use client";

import { Button } from "@/components/ui/button";
import type { TakeData } from "@/lib/take-api";
import { expiryNote, formatClock, shortDate } from "@/lib/take-display";
import { EmailSwitch } from "./email-switch";
import { StatusBadge } from "./status-badge";

/**
 * The Details tab (design.md §4b): what we know about the file (title, upload date, length,
 * format, how long the video is kept), the "Email me when takes are ready" switch and the
 * Delete row (spec 0013 AC-4), which opens the confirm dialog.
 */
export function TakeDetails({
  take,
  takeEmails,
  onEmailsSaved,
  onDelete,
}: {
  readonly take: TakeData;
  readonly takeEmails: boolean;
  readonly onEmailsSaved: (value: boolean) => void;
  readonly onDelete: (from: HTMLElement | null) => void;
}) {
  const expiry = expiryNote(take.videoExpiresAt, take.expired, new Date());
  const rows: readonly (readonly [string, React.ReactNode])[] = [
    ["Title", take.title],
    ["Status", <StatusBadge key="status" status={take.status} />],
    ["Uploaded", take.createdAt ? shortDate(take.createdAt) : "Not yet"],
    [
      "Length",
      take.durationMs !== null ? (
        <span className="mono">{formatClock(take.durationMs)}</span>
      ) : (
        "Not known yet"
      ),
    ],
    ["Format", take.container.toUpperCase()],
    ...(expiry ? ([["Retention", expiry]] as const) : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="divide-y divide-border text-small">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <EmailSwitch initial={takeEmails} onSaved={onEmailsSaved} />
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0 text-small">
          <p className="font-medium">Delete this take</p>
          <p className="text-muted-foreground">
            Video, cuts and transcript. Can&rsquo;t be undone.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Delete ${take.title}`}
          onClick={(event) => onDelete(event.currentTarget)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
