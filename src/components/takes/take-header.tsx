"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TakeData } from "@/lib/take-api";
import { expiryNote, formatClock } from "@/lib/take-display";
import { RenameForm } from "./rename-form";
import { StatusBadge } from "./status-badge";

/**
 * The take's title with Rename (AC-9), status badge, length in mono and expiry note. Rename
 * swaps the heading for a labelled form; focus returns to Rename when it closes.
 */
export function TakeHeader({
  take,
  onRenamed,
}: {
  readonly take: TakeData;
  readonly onRenamed: (take: TakeData) => void;
}) {
  const [editing, setEditing] = useState(false);
  const expiry = expiryNote(take.videoExpiresAt, take.expired, new Date());

  return (
    <div className="flex flex-col gap-2">
      {editing ? (
        <RenameForm
          take={take}
          onDone={(renamed) => {
            if (renamed) onRenamed(renamed);
            setEditing(false);
            requestAnimationFrame(() => document.getElementById("rename-button")?.focus());
          }}
        />
      ) : (
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 text-h1 font-semibold break-words">{take.title}</h1>
          <Button
            id="rename-button"
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => setEditing(true)}
          >
            <Icon icon={Pencil} size="badge" />
            Rename
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-muted">
        <StatusBadge status={take.status} />
        {take.durationMs !== null ? (
          <span className="mono">
            <span className="sr-only">Uploaded length </span>
            {formatClock(take.durationMs)}
          </span>
        ) : null}
        {expiry ? <span>{expiry}</span> : null}
      </div>
    </div>
  );
}
