"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TranscriptViewData } from "@/lib/take-api";
import { fixLine } from "@/lib/transcript-fixes";

/**
 * The fixes the AI made to the transcript (spec 0012, AC-6 to AC-8): one row per fix with its
 * reason and Undo, or Redo once undone. The result is announced in a polite status region; a
 * failure leaves the row as it was and says why. Renders nothing when there are no fixes.
 */
export function TranscriptFixes({
  edits,
  busy,
  error,
  onSet,
}: {
  readonly edits: TranscriptViewData["edits"];
  readonly busy: number | null;
  readonly error: string | null;
  readonly onSet: (index: number, undone: boolean) => Promise<boolean>;
}) {
  const [said, setSaid] = useState("");
  if (edits.length === 0) return null;
  const active = edits.filter((e) => !e.undone).length;

  const press = async (edit: TranscriptViewData["edits"][number]) => {
    const undone = !edit.undone;
    const ok = await onSet(edit.index, undone);
    if (ok) setSaid(`${undone ? "Undid" : "Redid"} the fix: ${fixLine(edit)}`);
  };

  return (
    <section aria-labelledby="fixes-heading" className="flex flex-col gap-2">
      <h3 id="fixes-heading" className="text-h4 font-medium">
        Fixes ({active})
      </h3>
      <ul className="m-0 flex max-w-[72ch] list-none flex-col gap-1 p-0">
        {edits.map((edit) => (
          <li
            key={edit.index}
            data-testid="fix-row"
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1"
          >
            <span className={edit.undone ? "text-muted-foreground line-through" : undefined}>
              {fixLine(edit)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={busy === edit.index}
              disabled={busy !== null}
              aria-label={`${edit.undone ? "Redo" : "Undo"} fix: ${fixLine(edit)}`}
              onClick={() => void press(edit)}
              className="shrink-0 pointer-coarse:min-h-11"
            >
              {edit.undone ? "Redo" : "Undo"}
            </Button>
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {said}
      </p>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
