"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RecordingContainer } from "@/lib/recorder-rules";
import { uploadFile } from "@/lib/upload-client";
import { checkFile } from "@/lib/upload-rules";
import { MEDIA_LIMITS } from "@/lib/take-rules";
import type { Container } from "@/lib/processing";
import { browserUploadIo } from "./browser-io";

/** The upload area's state (spec 0004, Screen states). */
export type UploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "uploading"; readonly fileName: string; readonly percent: number }
  | { readonly kind: "completing"; readonly fileName: string }
  | { readonly kind: "cancelled" };

const busy = (state: UploadState) => state.kind === "uploading" || state.kind === "completing";

/**
 * Runs one upload at a time from the library: checks the file in the browser (AC-2), uploads
 * it (AC-3), warns before leaving mid upload, and opens the take page when it is done.
 */
export function useUpload() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!busy(state)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (
      file: File,
      container: Container,
      backgroundId?: string,
      recording?: { readonly script: string },
    ) => {
      const abort = new AbortController();
      controller.current = abort;
      setState({ kind: "uploading", fileName: file.name, percent: 0 });
      const outcome = await uploadFile(
        file,
        container,
        browserUploadIo,
        abort.signal,
        {
          onProgress: (percent) =>
            setState((s) => (s.kind === "uploading" ? { ...s, percent } : s)),
          onPhase: (phase) => {
            if (phase === "completing") setState({ kind: "completing", fileName: file.name });
          },
        },
        backgroundId,
        recording,
      );
      controller.current = null;
      if (outcome.ok) {
        // Leave the state busy until the take page replaces this one.
        router.push(`/takes/${outcome.takeId}`);
        return outcome;
      }
      setState(
        outcome.reason === "cancelled"
          ? { kind: "cancelled" }
          : { kind: "rejected", message: outcome.message },
      );
      return outcome;
    },
    [router],
  );

  const start = useCallback(
    async (file: File, backgroundId?: string) => {
      if (controller.current) return;
      const check = checkFile({ name: file.name, size: file.size, type: file.type });
      if (!check.ok) {
        setState({ kind: "rejected", message: check.message });
        return;
      }
      await run(file, check.container, backgroundId);
    },
    [run],
  );

  /**
   * Uploads a take recorded in the browser (spec 0021): the same flow as a chosen file, with
   * the container the recorder picked. Resolves with the outcome so the recorder can keep the
   * take when it fails.
   */
  const startRecording = useCallback(
    async (file: File, container: RecordingContainer, script: string, backgroundId?: string) => {
      if (controller.current) return null;
      if (file.size <= 0 || file.size > MEDIA_LIMITS.maxBytes) {
        const message =
          file.size <= 0
            ? "This recording is empty. Record it again."
            : "This recording is over 2 GB. Record a shorter one.";
        setState({ kind: "rejected", message });
        return { ok: false, reason: "failed", message } as const;
      }
      return run(file, container, backgroundId, { script });
    },
    [run],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { state, start, startRecording, cancel, busy: busy(state) };
}
