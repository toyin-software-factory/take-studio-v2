"use client";

import type { TakeData } from "@/lib/take-api";
import { expiryNote, formatClock, shortDate } from "@/lib/take-display";
import { EmailSwitch } from "./email-switch";
import { StatusBadge } from "./status-badge";

/**
 * The Details tab (design.md §4b): what we know about the file (title, upload date, length,
 * format, how long the video is kept) and the "Email me when takes are ready" switch. Only
 * built things: deleting a take arrives with the library (slice 6).
 */
export function TakeDetails({
  take,
  takeEmails,
  onEmailsSaved,
}: {
  readonly take: TakeData;
  readonly takeEmails: boolean;
  readonly onEmailsSaved: (value: boolean) => void;
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
    </div>
  );
}
