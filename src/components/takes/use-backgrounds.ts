"use client";

import { useCallback, useEffect, useState } from "react";
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

/**
 * Reads GET /api/backgrounds once (spec 0008, AC-1) for the upload area's picker. A failed read
 * is a state, not an error: the creator can still upload with "Keep original".
 */
export function useBackgrounds() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void fetchList().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    void fetchList().then(setState);
  }, []);
  return { state, reload };
}
