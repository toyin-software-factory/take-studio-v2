"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type BackgroundListData, backgroundListSchema } from "@/lib/background-api";
import { callApi } from "./browser-io";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly list: BackgroundListData }
  | { readonly kind: "failed" };

async function fetchList(): Promise<State> {
  const reply = await callApi("/api/backgrounds", "GET").catch(() => null);
  const parsed = backgroundListSchema.safeParse(reply?.data);
  return reply?.status === 200 && parsed.success
    ? { kind: "ready", list: parsed.data }
    : { kind: "failed" };
}

/** The list without the backgrounds the creator deleted on this page (and their default). */
function without(state: State, deleted: ReadonlySet<string>): State {
  if (state.kind !== "ready" || deleted.size === 0) return state;
  const { list } = state;
  return {
    kind: "ready",
    list: {
      ...list,
      mine: list.mine.filter((item) => !deleted.has(item.id)),
      defaultId: list.defaultId !== null && deleted.has(list.defaultId) ? null : list.defaultId,
    },
  };
}

/**
 * Reads GET /api/backgrounds for the picker (spec 0008, AC-1). A failed read is a state, not an
 * error: the creator can still upload with "Keep original". A refresh keeps the list on screen,
 * and every result, however late, is filtered by the deletions made on this page, so a reload
 * that fetched the list before a delete cannot bring the deleted background back.
 */
export function useBackgrounds() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const deleted = useRef(new Set<string>());
  useEffect(() => {
    let live = true;
    void fetchList().then((next) => {
      if (live) setState(without(next, deleted.current));
    });
    return () => {
      live = false;
    };
  }, []);
  // A failed refresh keeps the old list; only a first or failed load shows as loading.
  const reload = useCallback(() => {
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    void fetchList().then((next) =>
      setState((prev) =>
        next.kind === "failed" && prev.kind === "ready" ? prev : without(next, deleted.current),
      ),
    );
  }, []);
  // A deleted background leaves the cached list at once, so its tile cannot be picked and an
  // upload falls back to Keep original even before (or without) a successful refresh.
  const forget = useCallback((id: string) => {
    deleted.current.add(id);
    setState((prev) => without(prev, new Set([id])));
  }, []);
  return { state, reload, forget };
}
