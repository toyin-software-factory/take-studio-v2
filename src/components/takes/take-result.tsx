"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { notify } from "@/components/ui/sonner";
import { type TakeDetail, apiMessage, mediaLinkSchema } from "@/lib/take-api";
import { TAKE_NOTES, removedNote } from "@/lib/take-display";
import { callApi } from "./browser-io";

type Kind = "download" | "original";

/**
 * Under the player when a take is ready (AC-7, AC-9): "Removed m:ss of pauses" or the AC-7
 * note, then Download (`<slug>-trimmed.mp4`, or the original when nothing was trimmed) and
 * Download original. Each asks for a 15 minute attachment link, then the browser saves it.
 */
export function TakeResult({ detail }: { readonly detail: TakeDetail }) {
  const [pending, setPending] = useState<Kind | null>(null);
  const { take, note, removedMs } = detail;
  if (take.status !== "ready" || take.expired) return null;

  const download = async (kind: Kind) => {
    setPending(kind);
    try {
      const reply = await callApi(`/api/takes/${take.id}/media?kind=${kind}`, "GET");
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

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-medium">{note ? TAKE_NOTES[note] : removedNote(removedMs)}</p>
      <div className="flex flex-wrap gap-2">
        <Button loading={pending === "download"} onClick={() => void download("download")}>
          <Icon icon={Download} size="badge" />
          Download
        </Button>
        <Button
          variant="secondary"
          loading={pending === "original"}
          onClick={() => void download("original")}
        >
          Download original
        </Button>
      </div>
    </div>
  );
}
