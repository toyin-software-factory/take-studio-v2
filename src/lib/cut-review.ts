import { effectiveRemovedRanges, type Range } from "./cut-rules";

/**
 * Pure model of the cut review page state (spec 0011). `current` is what the server says; the
 * creator's `edits` hold only what differs from it, so a rebase just drops edits that now match.
 */

export type ReviewCut = Range & {
  readonly id: string;
  readonly kind: string;
  readonly applied: boolean;
  /** Spec 0012: why the cut was made (null or absent on older cuts). */
  readonly reason?: string | null;
};

/** Background as the page sees it: an id, null for the original, undefined for no change. */
export type Edits = {
  readonly cuts: Readonly<Record<string, boolean>>;
  readonly background: string | null | undefined;
};

export const NO_EDITS: Edits = { cuts: {}, background: undefined };

export type NumberedCut = ReviewCut & {
  readonly n: number;
  readonly label: string;
  readonly lower: string;
};

/** Cuts in time order, numbered from 1, labelled "Pause N" or "Cut N". */
export function numberCuts(cuts: readonly ReviewCut[]): readonly NumberedCut[] {
  return [...cuts]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((cut, i) => {
      const label = `${cut.kind === "pause" ? "Pause" : "Cut"} ${i + 1}`;
      return { ...cut, n: i + 1, label, lower: label.toLowerCase() };
    });
}

/** Rounded to one decimal, half up, in seconds. */
export function secondsText(ms: number): string {
  const tenths = Math.floor((ms + 50) / 100);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** AC-2 accessible name. */
export function cutName(cut: NumberedCut, applied: boolean): string {
  const base = `${cut.label}, ${secondsText(cut.endMs - cut.startMs)} seconds`;
  return applied ? `${base}, cut. Press to keep it.` : `${base}, kept. Press to cut it.`;
}

/** Spec 0012 AC-3: the reason line, "Cut 4: You restarted the sentence."; null with no reason. */
export function reasonLine(cut: NumberedCut | undefined): string | null {
  const reason = cut?.reason?.trim();
  return cut && reason ? `${cut.label}: ${reason}` : null;
}

/** AC-1 summary line over the pending state. */
export function summaryLine(
  cuts: readonly { readonly ms: number; readonly kind?: string }[],
): string {
  if (cuts.length === 0) return "No pauses cut.";
  const saved = secondsText(cuts.reduce((s, c) => s + c.ms, 0));
  const words = cuts.filter((c) => c.kind !== undefined && c.kind !== "pause").length;
  const pauses = cuts.length - words;
  if (words === 0) {
    return pauses === 1
      ? `1 pause cut, ${saved} s saved.`
      : `${pauses} pauses cut, ${saved} s saved.`;
  }
  const wordText = `${words} word ${words === 1 ? "cut" : "cuts"}`;
  const pauseText = `${pauses} ${pauses === 1 ? "pause" : "pauses"}`;
  return pauses === 0
    ? `${wordText}, ${saved} s saved.`
    : `${wordText} and ${pauseText}, ${saved} s saved.`;
}

export function pendingApplied(cut: ReviewCut, edits: Edits): boolean {
  return edits.cuts[cut.id] ?? cut.applied;
}

/** Drops edits equal to the current state. `currentBackground` is an id, null or "deleted". */
export function normalizeEdits(
  edits: Edits,
  cuts: readonly ReviewCut[],
  currentBackground: string | null,
): Edits {
  const byId = new Map(cuts.map((c) => [c.id, c.applied]));
  const kept: Record<string, boolean> = {};
  for (const [id, applied] of Object.entries(edits.cuts)) {
    const now = byId.get(id);
    if (now !== undefined && now !== applied) kept[id] = applied;
  }
  const background =
    edits.background !== undefined && edits.background === currentBackground
      ? undefined
      : edits.background;
  return { cuts: kept, background };
}

export function toggleCut(
  edits: Edits,
  cuts: readonly ReviewCut[],
  currentBackground: string | null,
  cutId: string,
): Edits {
  const cut = cuts.find((c) => c.id === cutId);
  if (!cut) return edits;
  const next = !pendingApplied(cut, edits);
  return normalizeEdits(
    { ...edits, cuts: { ...edits.cuts, [cutId]: next } },
    cuts,
    currentBackground,
  );
}

export function setBackgroundEdit(
  edits: Edits,
  cuts: readonly ReviewCut[],
  currentBackground: string | null,
  background: string | null,
): Edits {
  return normalizeEdits({ ...edits, background }, cuts, currentBackground);
}

export const hasEdits = (edits: Edits): boolean =>
  Object.keys(edits.cuts).length > 0 || edits.background !== undefined;

export type PendingItem = { readonly key: string; readonly text: string };

/** AC-4: cuts in time order, then the background. */
export function pendingItems(
  cuts: readonly ReviewCut[],
  edits: Edits,
  backgroundName: (id: string | null) => string,
): readonly PendingItem[] {
  const items: PendingItem[] = numberCuts(cuts)
    .filter((c) => edits.cuts[c.id] !== undefined)
    .map((c) => ({
      key: c.id,
      text: `${edits.cuts[c.id] ? "Cut" : "Keep"} ${c.lower}`,
    }));
  if (edits.background !== undefined) {
    items.push({ key: "background", text: `Background: ${backgroundName(edits.background)}` });
  }
  return items;
}

/** The ranges the preview skips: the pending state of every cut. */
export function pendingRanges(cuts: readonly ReviewCut[], edits: Edits): readonly Range[] {
  return effectiveRemovedRanges(
    cuts,
    Object.entries(edits.cuts).map(([cutId, applied]) => ({ cutId, applied })),
  );
}

/** The body of POST /changes for these edits. */
export function changeBody(
  baseRenderId: string,
  edits: Edits,
): {
  baseRenderId: string;
  cuts?: { id: string; applied: boolean }[];
  background?: { id: string | null };
} {
  const cuts = Object.entries(edits.cuts).map(([id, applied]) => ({ id, applied }));
  return {
    baseRenderId,
    ...(cuts.length > 0 ? { cuts } : {}),
    ...(edits.background !== undefined ? { background: { id: edits.background } } : {}),
  };
}

/** AC-1 width rule: at least the container, 8 px per second. */
export function timelineWidth(containerPx: number, durationMs: number): number {
  return Math.max(containerPx, Math.ceil((durationMs / 1000) * 8));
}

/** A block's box in px: visible width at least 12, hit width at least 24, centred and clamped. */
export function blockRect(
  cut: Range,
  durationMs: number,
  widthPx: number,
): { left: number; width: number; hitLeft: number; hitWidth: number } {
  const px = (ms: number) => (ms / durationMs) * widthPx;
  const centre = (px(cut.startMs) + px(cut.endMs)) / 2;
  const width = Math.max(12, px(cut.endMs) - px(cut.startMs));
  const hitWidth = Math.max(24, width);
  const clamp = (left: number, w: number) => Math.min(Math.max(0, left), Math.max(0, widthPx - w));
  return {
    left: clamp(centre - width / 2, width),
    width,
    hitLeft: clamp(centre - hitWidth / 2, hitWidth),
    hitWidth,
  };
}
