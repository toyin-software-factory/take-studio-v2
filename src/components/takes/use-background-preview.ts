"use client";

import { useEffect, useState } from "react";
import { PREVIEW_CHECKS, previewViewSchema } from "@/lib/background-preview-api";
import { ORIGINAL_BACKGROUND } from "@/lib/background-api";
import { apiMessage } from "@/lib/take-api";
import { callApi } from "./browser-io";

export type PreviewState =
  | { readonly kind: "idle" }
  | { readonly kind: "making" }
  | { readonly kind: "ready"; readonly url: string; readonly noGreenScreen: boolean }
  | { readonly kind: "failed"; readonly message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks for the preview, then checks every 2 s until it is ready or failed. */
async function fetchPreview(
  takeId: string,
  backgroundId: string,
  stopped: () => boolean,
): Promise<PreviewState> {
  const base = `/api/takes/${takeId}/background/preview`;
  const asked = await callApi(base, "POST", { backgroundId }).catch(() => null);
  const failed = (message: string): PreviewState => ({ kind: "failed", message });
  if (!asked) return failed("The preview didn't start. Check your connection and try again.");
  let view = previewViewSchema.safeParse(asked.data);
  if (asked.status !== 200 && asked.status !== 202) {
    return failed(apiMessage(asked.data, "The preview didn't start. Please try again."));
  }
  for (let i = 0; i < PREVIEW_CHECKS; i += 1) {
    if (stopped()) return { kind: "idle" };
    if (view.success && view.data.state === "ready" && view.data.url) {
      return { kind: "ready", url: view.data.url, noGreenScreen: view.data.noGreenScreen };
    }
    if (view.success && view.data.state === "failed") {
      return failed("The preview didn't work out. Choose it again to try once more.");
    }
    await sleep(2000);
    const next = await callApi(`${base}?backgroundId=${backgroundId}`, "GET").catch(() => null);
    if (next && next.status !== 200) {
      return failed(apiMessage(next.data, "The preview isn't available. Please try again."));
    }
    if (next) view = previewViewSchema.safeParse(next.data);
  }
  return failed("The preview is taking longer than expected. Choose it again to try once more.");
}

/**
 * The still of the take on the chosen background (spec 0008, AC-4): none for "Keep original" or
 * when nothing is chosen (`enabled` false), otherwise the preview for that background, shown
 * as `making` until the answer for this choice arrives. A new choice abandons the old checks.
 */
export function useBackgroundPreview(
  takeId: string,
  choice: string,
  enabled: boolean,
  attempt: number,
): PreviewState {
  const wanted = enabled && choice !== ORIGINAL_BACKGROUND;
  const key = `${choice}:${attempt}`;
  const [answer, setAnswer] = useState<{ key: string; state: PreviewState } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let stop = false;
    void fetchPreview(takeId, choice, () => stop).then((state) => {
      if (!stop) setAnswer({ key, state });
    });
    return () => {
      stop = true;
    };
  }, [takeId, choice, wanted, key]);

  if (!wanted) return { kind: "idle" };
  return answer?.key === key ? answer.state : { kind: "making" };
}
