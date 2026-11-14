"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/take-display";
import { callApi } from "./browser-io";

type Note =
  | { readonly kind: "none" }
  | { readonly kind: "noted"; readonly atMs: number }
  | { readonly kind: "failed" };

/** The line a press leaves in the live region (spec 0017 AC-3). */
export function missedNoteText(note: Note): string {
  if (note.kind === "noted") {
    return `Thanks, noted at ${formatClock(note.atMs)}. This helps us improve AI edits.`;
  }
  return note.kind === "failed" ? "Couldn’t note that. Try again." : "";
}

/**
 * "Missed something?" beside the player controls (spec 0017 AC-3): one press sends the playhead
 * time (ms on the edited video) and nothing else. It changes no cut and starts no render. The
 * status region is always in the page, so the confirmation is announced politely when it fills.
 */
export function MissedButton({
  takeId,
  playheadMs,
}: {
  readonly takeId: string;
  /** The current time on the edited video, read at the press. */
  readonly playheadMs: () => number;
}) {
  const [note, setNote] = useState<Note>({ kind: "none" });
  const [sending, setSending] = useState(false);

  async function press() {
    const atMs = Math.max(0, Math.round(playheadMs()));
    setSending(true);
    try {
      const reply = await callApi(`/api/takes/${takeId}/missed`, "POST", { atMs });
      setNote(reply.status === 204 ? { kind: "noted", atMs } : { kind: "failed" });
    } catch {
      setNote({ kind: "failed" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="lg" loading={sending} onClick={() => void press()}>
        Missed something?
      </Button>
      <p
        role="status"
        aria-live="polite"
        data-testid="missed-note"
        className="min-w-0 flex-1 text-small"
      >
        {missedNoteText(note)}
      </p>
    </div>
  );
}
