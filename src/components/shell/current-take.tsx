"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

/** The take the page shows, for the breadcrumb and the status chip in the top bar. */
export type ShellCurrent = { readonly title: string; readonly status: string };

type Store = {
  readonly current: ShellCurrent | undefined;
  readonly set: (next: ShellCurrent | undefined) => void;
};

const CurrentTake = createContext<Store | null>(null);

/**
 * Holds the current take for the top bar. The page gives the first value (rendered on the
 * server); the live take page then publishes every change of title or status, so the
 * breadcrumb follows a rename and the chip follows processing to ready without a reload.
 */
export function CurrentTakeProvider({
  initial,
  children,
}: {
  readonly initial: ShellCurrent | undefined;
  readonly children: React.ReactNode;
}) {
  const [current, set] = useState(initial);
  const value = useMemo(() => ({ current, set }), [current]);
  return <CurrentTake.Provider value={value}>{children}</CurrentTake.Provider>;
}

/** What the top bar shows: the latest published take, else the one the page started with. */
export function useCurrentTake(): ShellCurrent | undefined {
  return useContext(CurrentTake)?.current;
}

/** For the take page: keeps the top bar's breadcrumb and chip equal to the live take. */
export function usePublishCurrentTake(title: string, status: string): void {
  const store = useContext(CurrentTake);
  const set = store?.set;
  useEffect(() => {
    set?.({ title, status });
  }, [set, title, status]);
}
