"use client";

import { useCallback, useEffect, useState } from "react";
import { type ConnectedAppView, connectedAppsSchema, disconnectDone } from "@/lib/oauth-screen";

const TIMEOUT_MS = 30_000;

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly apps: readonly ConnectedAppView[] };

async function request(path: string, method: "GET" | "DELETE") {
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data: unknown = await response.json().catch(() => null);
    return { status: response.status, data };
  } catch {
    return { status: null, data: null };
  }
}

/** Loads the creator's connected apps and disconnects one (spec 0019 AC-14). */
export function useConnectedApps() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void request("/api/connected-apps", "GET").then((reply) => {
      if (!live) return;
      const parsed = reply.status === 200 ? connectedAppsSchema.safeParse(reply.data) : null;
      setLoad(parsed?.success ? { kind: "ready", apps: parsed.data.apps } : { kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const disconnect = useCallback(async (id: string) => {
    const { status } = await request(`/api/connected-apps/${encodeURIComponent(id)}`, "DELETE");
    if (!disconnectDone(status)) return false;
    setLoad((current) =>
      current.kind === "ready"
        ? { kind: "ready", apps: current.apps.filter((app) => app.id !== id) }
        : current,
    );
    return true;
  }, []);

  return { load, retry, disconnect };
}
