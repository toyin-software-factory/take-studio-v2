"use client";

import { useState } from "react";
import { notify } from "@/components/ui/sonner";
import { apiMessage, mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";

export type DownloadKind = "download" | "original";

/**
 * Asks the server for a 15 minute attachment link (`?kind=download` or `?kind=original`), then
 * has the browser save it. `pending` is the kind being fetched, for a loading button. Shared by
 * the summary row and the Export tab, so both behave the same.
 */
export function useTakeDownloads(takeId: string) {
  const [pending, setPending] = useState<DownloadKind | null>(null);

  const download = async (kind: DownloadKind) => {
    setPending(kind);
    try {
      const reply = await callApi(`/api/takes/${takeId}/media?kind=${kind}`, "GET");
      const parsed = mediaLinkSchema.safeParse(reply.data);
      if (reply.status === 200 && parsed.success) window.location.assign(parsed.data.url);
      else
        notify("error", {
          title: apiMessage(reply.data, "The download didn't start. Please try again."),
        });
    } catch {
      notify("error", { title: "The download didn't start. Check your connection and try again." });
    } finally {
      setPending(null);
    }
  };

  return { pending, download };
}
