"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile } from "@/lib/upload-client";
import { checkFile } from "@/lib/upload-rules";
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

  const start = useCallback(
    async (file: File) => {
      if (controller.current) return;
      const check = checkFile({ name: file.name, size: file.size, type: file.type });
      if (!check.ok) {
        setState({ kind: "rejected", message: check.message });
        return;
      }
      const abort = new AbortController();
      controller.current = abort;
      setState({ kind: "uploading", fileName: file.name, percent: 0 });
      const outcome = await uploadFile(file, check.container, browserUploadIo, abort.signal, {
        onProgress: (percent) => setState((s) => (s.kind === "uploading" ? { ...s, percent } : s)),
        onPhase: (phase) => {
          if (phase === "completing") setState({ kind: "completing", fileName: file.name });
        },
      });
      controller.current = null;
      if (outcome.ok) {
        // Leave the state busy until the take page replaces this one.
        router.push(`/takes/${outcome.takeId}`);
        return;
      }
      setState(
        outcome.reason === "cancelled"
          ? { kind: "cancelled" }
          : { kind: "rejected", message: outcome.message },
      );
    },
    [router],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { state, start, cancel, busy: busy(state) };
}
