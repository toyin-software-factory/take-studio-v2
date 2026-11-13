"use client";

import { useCallback, useMemo, useState } from "react";
import { ORIGINAL_BACKGROUND } from "@/lib/background-api";
import {
  type Edits,
  NO_EDITS,
  hasEdits,
  normalizeEdits,
  numberCuts,
  pendingApplied,
  pendingItems,
  pendingRanges,
  setBackgroundEdit,
  toggleCut,
} from "@/lib/cut-review";
import type { TakeDetail } from "@/lib/take-api";
import { backgroundChangeActive } from "@/lib/take-display";
import { useChangeRender } from "./use-change-render";
import { type OriginalState, useOriginalSource } from "./use-original-source";
import type { PollResult } from "./use-poll";

/** Stands for "the video is keyed on a background that was deleted": not the original. */
export const DELETED = "deleted";

function currentBackground(detail: TakeDetail | null): string | null {
  const bg = detail?.background;
  return bg ? (bg.id ?? DELETED) : null;
}

/** A keyed take whose background was deleted starts with "Background: Original" pending (AC-8). */
function seedFor(detail: TakeDetail | null): Edits {
  return currentBackground(detail) === DELETED ? { cuts: {}, background: null } : NO_EDITS;
}

/**
 * The page state of the cut review (spec 0011, "State model"): `current` is the take GET, the
 * creator's `edits` hold only what differs from it (so a reload rebases by dropping edits that
 * now match), and one render sends them with the latest render's id. While a job runs, from
 * here or from another tab, the edits are frozen and everything is locked.
 */
export function useCutReview(
  detail: TakeDetail | null,
  reload: () => Promise<PollResult>,
  bridgeTakeId: string,
) {
  // null: untouched, so the seed (a deleted background reads as "Original" pending) applies.
  const [raw, setRaw] = useState<Edits | null>(null);
  const [goneOriginal, setGoneOriginal] = useState(false);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [waveformKey, setWaveformKey] = useState(0);
  const cuts = useMemo(() => detail?.cuts ?? [], [detail?.cuts]);
  const bg = currentBackground(detail);
  const baseRenderId = detail?.latestRender?.id ?? null;

  const base = raw ?? seedFor(detail);
  const normalized = useMemo(() => normalizeEdits(base, cuts, bg), [base, cuts, bg]);
  // Rebase: an edit another tab made redundant is dropped for good, not hidden.
  if (raw !== null && JSON.stringify(normalized) !== JSON.stringify(raw)) setRaw(normalized);

  const render = useChangeRender(bridgeTakeId, baseRenderId, {
    reload,
    onSucceeded: useCallback(() => {
      setRaw(NO_EDITS);
      setWaveformKey((n) => n + 1);
    }, []),
    onOriginalGone: useCallback(() => setGoneOriginal(true), []),
  });
  const { phase } = render;
  const rendering = phase.kind === "starting" || phase.kind === "rendering";
  const otherJob = !rendering && backgroundChangeActive(detail?.backgroundJob ?? null);
  const locked = rendering || otherJob;
  const edits = rendering ? phase.frozen : normalized;
  const pendingNow = hasEdits(edits);

  const cutEdits = Object.keys(edits.cuts).length > 0;
  const original = useOriginalSource(bridgeTakeId, detail?.take.container ?? "mp4", cutEdits);
  const originalState: OriginalState = original.state;
  const readOnly =
    goneOriginal || detail?.originalAvailable === false || originalState.kind === "gone";

  const edit = (fn: (e: Edits) => Edits) => {
    if (locked || readOnly) return;
    render.clearMessage();
    setRaw(fn(normalized));
  };
  const items = pendingItems(cuts, edits, (id) =>
    id === null ? "Original" : (names[id] ?? "this background"),
  );

  return {
    numbered: numberCuts(cuts),
    edits,
    applied: (cutId: string) => {
      const cut = cuts.find((c) => c.id === cutId);
      return cut ? pendingApplied(cut, edits) : false;
    },
    toggle: (cutId: string) => edit((e) => toggleCut(e, cuts, bg, cutId)),
    pickBackground: (id: string | null) =>
      edit((e) => setBackgroundEdit(e, cuts, bg, id === ORIGINAL_BACKGROUND ? null : id)),
    discard: () => {
      if (locked) return;
      render.clearMessage();
      setRaw(null);
    },
    rememberBackground: (id: string, name: string) =>
      setNames((n) => (n[id] === name ? n : { ...n, [id]: name })),
    items,
    ranges: pendingRanges(cuts, edits),
    renderRanges: detail?.latestRender?.removedRanges ?? [],
    hasEdits: pendingNow,
    cutEdits,
    locked,
    rendering: rendering || otherJob,
    readOnly,
    phase,
    message: render.message,
    limited: render.limited,
    canRender: !readOnly && !render.limited && baseRenderId !== null,
    start: () => void render.start(normalized),
    waveformKey,
    original,
    originalState,
    /** Edits that were seeded or typed but not yet sent (drives the leave warning). */
    unsent: pendingNow && !rendering,
  };
}

export type CutReview = ReturnType<typeof useCutReview>;
