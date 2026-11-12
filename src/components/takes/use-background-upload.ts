"use client";

import { useCallback, useState } from "react";
import {
  BACKGROUND_UPLOAD,
  backgroundFailureMessage,
  isBackgroundContentType,
} from "@/lib/background-rules";
import { backgroundListSchema } from "@/lib/background-api";
import { apiMessage } from "@/lib/take-api";
import { callApi } from "./browser-io";

export type BackgroundUploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly step: "uploading" | "processing" }
  | { readonly kind: "failed"; readonly message: string };

/** About a minute of 2 s checks for the image to be processed. */
const CHECKS = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads an image as a background (spec 0008, AC-8): checks the type and size, gets a presigned
 * link, PUTs the file straight to storage, completes, then waits for ingest to say ready or
 * failed (with the friendly message for the code). `onReady` gets the new background's ID so
 * the picker can select it. Deleting is one call; a refusal ("In use") comes back as the message.
 */
export function useBackgroundUpload(onChanged: () => void, onReady: (id: string) => void) {
  const [state, setState] = useState<BackgroundUploadState>({ kind: "idle" });
  const fail = (message: string) => setState({ kind: "failed", message });

  const start = useCallback(
    async (file: File) => {
      if (!isBackgroundContentType(file.type)) return fail("Choose a JPEG, PNG or WebP image.");
      if (file.size > BACKGROUND_UPLOAD.maxBytes)
        return fail("That image is over 10 MB. Choose a smaller one.");
      setState({ kind: "working", step: "uploading" });
      try {
        const name = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Background";
        const created = await callApi("/api/backgrounds", "POST", {
          name,
          contentType: file.type,
          bytes: file.size,
        });
        const body = created.data as { id?: string; uploadUrl?: string } | null;
        if (created.status !== 201 || !body?.id || !body.uploadUrl) {
          return fail(apiMessage(created.data, "The image didn't upload. Please try again."));
        }
        const put = await fetch(body.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!put.ok) return fail("The image didn't upload. Check your connection and try again.");
        const done = await callApi(`/api/backgrounds/${body.id}/complete`, "POST");
        if (done.status !== 200)
          return fail(apiMessage(done.data, "The image didn't upload. Please try again."));
        setState({ kind: "working", step: "processing" });
        for (let i = 0; i < CHECKS; i += 1) {
          await sleep(2000);
          const listed = await callApi("/api/backgrounds", "GET").catch(() => null);
          const parsed = backgroundListSchema.safeParse(listed?.data);
          const item = parsed.success ? parsed.data.mine.find((b) => b.id === body.id) : undefined;
          if (item?.status === "ready") {
            setState({ kind: "idle" });
            onChanged();
            onReady(item.id);
            return;
          }
          if (item?.status === "failed") {
            onChanged();
            return fail(backgroundFailureMessage(item.failureCode));
          }
        }
        onChanged();
        fail("That image is taking longer than expected. Check back in a minute.");
      } catch {
        fail("The image didn't upload. Check your connection and try again.");
      }
    },
    [onChanged, onReady],
  );

  const remove = useCallback(
    async (id: string) => {
      const reply = await callApi(`/api/backgrounds/${id}`, "DELETE").catch(() => null);
      if (reply?.status === 204) {
        setState({ kind: "idle" });
        onChanged();
      } else {
        fail(apiMessage(reply?.data, "That background couldn't be deleted. Please try again."));
      }
    },
    [onChanged],
  );

  return { state, start, remove };
}
