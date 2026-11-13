"use client";

import { useRef, useState } from "react";
import { EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import type { TakeData } from "@/lib/take-api";
import { expiryNote, formatClock } from "@/lib/take-display";
import { RenameForm } from "./rename-form";

/**
 * The take's title with Rename (AC-9), length in mono and expiry note (the status chip is in the top bar). Rename
 * swaps the heading for a labelled form; focus returns to Rename when it closes.
 */
export function TakeHeader({
  take,
  onRenamed,
  onDelete,
}: {
  readonly take: TakeData;
  readonly onRenamed: (take: TakeData) => void;
  readonly onDelete: (from: HTMLElement | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
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
          <h1 className="min-w-0 text-h1 font-medium break-words">{take.title}</h1>
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
          {/* modal={false}: the dialog opens as the menu closes, and a modal menu would hold
              the page's pointer events and fight the dialog's focus trap. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuButton}
                variant="ghost"
                size="icon"
                className="mt-0.5"
                aria-label="More actions for this take"
              >
                <Icon icon={EllipsisVertical} size="badge" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                aria-label={`Delete ${take.title}`}
                onSelect={() => onDelete(menuButton.current)}
              >
                <Trash2 aria-hidden="true" />
                Delete take
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
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
