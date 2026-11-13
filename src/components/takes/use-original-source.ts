"use client";

import { useCallback, useEffect, useState } from "react";
import { mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";

/** The original recording as a preview source (spec 0011, AC-3, AC-8). */
export type OriginalState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "unplayable" }
  | { readonly kind: "gone" }
  | { readonly kind: "failed" };

const PROBE_MS = 20_000;

type LinkResult =
  { readonly kind: "ok"; readonly url: string } | { readonly kind: "gone" | "failed" };

async function originalLink(takeId: string): Promise<LinkResult> {
  const reply = await callApi(`/api/takes/${takeId}/media?kind=original`, "GET").catch(() => null);
  if (reply?.status === 410) return { kind: "gone" };
  const parsed = mediaLinkSchema.safeParse(reply?.data);
  return reply?.status === 200 && parsed.success
    ? { kind: "ok", url: parsed.data.url }
    : { kind: "failed" };
}

/** True when a hidden video element can read the file's metadata (the real playability check). */
function probe(url: string, container: string): Promise<boolean> {
  const el = document.createElement("video");
  const mime = container === "mov" ? "video/quicktime" : "video/mp4";
  // Only a MOV needs the gate: an MP4 the browser cannot name still gets the real metadata probe.
  if (container === "mov" && el.canPlayType(mime) === "") return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), PROBE_MS);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(true);
    el.onerror = () => done(false);
    el.src = url;
  });
}

/**
 * Gets a link to the original and checks the browser can play it, once `wanted` (a pending cut
 * change exists). `refresh` asks for one fresh link after a media error; only a 410 means the
 * original is gone, any other failure is `failed` (the render keeps playing).
 */
export function useOriginalSource(takeId: string, container: string, wanted: boolean) {
  const [result, setResult] = useState<OriginalState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void (async () => {
      const link = await originalLink(takeId);
      if (!live) return;
      if (link.kind !== "ok") return setResult({ kind: link.kind });
      const ok = await probe(link.url, container);
      if (live) setResult(ok ? { kind: "ready", url: link.url } : { kind: "unplayable" });
    })();
    return () => {
      live = false;
    };
  }, [takeId, container, wanted, attempt]);

  const refresh = useCallback(async (): Promise<void> => {
    const link = await originalLink(takeId);
    setResult(link.kind === "ok" ? { kind: "ready", url: link.url } : { kind: link.kind });
  }, [takeId]);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);
  /** The link was fresh and the file still would not play: stop trying, the render stays. */
  const fail = useCallback(() => setResult({ kind: "failed" }), []);
  // Nothing asked yet (or a retry in flight) while a change is pending is "checking".
  const state: OriginalState = result ?? (wanted ? { kind: "checking" } : { kind: "idle" });
  return { state, refresh, retry, fail };
}
