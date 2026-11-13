import type { TranscriptViewData } from "./take-api";

/**
 * Pure helpers for the transcript fixes list (spec 0012, AC-6 to AC-8). The words the server sends
 * already show the edited text; undoing or redoing a fix swaps that one word between `old` and
 * `new`, so the panel can update at once while the caption track reloads from the new version.
 */

/** The text of a fix as a line: "old" to "new", then the reason. */
export function fixLine(edit: { old: string; new: string; reason: string }): string {
  const reason = edit.reason.trim();
  return `“${edit.old}” → “${edit.new}”${reason ? `: ${reason}` : ""}`;
}

/** The view with one fix undone or redone, its word showing the matching text, and a new version. */
export function withEditUndone(
  view: TranscriptViewData,
  index: number,
  undone: boolean,
  version: string | undefined,
): TranscriptViewData {
  const edit = view.edits.find((e) => e.index === index);
  if (!edit) return view;
  const text = undone ? edit.old : edit.new;
  return {
    ...view,
    version: version ?? view.version,
    edits: view.edits.map((e) => (e.index === index ? { ...e, undone } : e)),
    paragraphs: view.paragraphs?.map((p) => ({
      ...p,
      words: p.words.map((w) => (w.index === index ? { ...w, w: text } : w)),
    })),
  };
}

/** The fixes whose word is in the trimmed video (a fix in a cut part has nothing to show). */
export function visibleEdits(view: TranscriptViewData): TranscriptViewData["edits"] {
  const shown = new Set((view.paragraphs ?? []).flatMap((p) => p.words.map((w) => w.index)));
  return view.edits.filter((e) => shown.has(e.index));
}
