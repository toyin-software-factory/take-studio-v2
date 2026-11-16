"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { DROP_COPY, type DropRefusal, checkGuestFile, refusalOf } from "@/lib/guest-drop";
import { callApi } from "@/components/takes/browser-io";
import { uploadFile } from "@/lib/upload-client";
import { guestUploadIo } from "./guest-io";
import { turnstileToken } from "./turnstile";

/** The drop box's upload side (spec 0023, AC-1): one file at a time, no account. */
export type DropState =
  | { readonly kind: "idle" }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "checking"; readonly fileName: string }
  | { readonly kind: "uploading"; readonly fileName: string; readonly percent: number }
  | { readonly kind: "done"; readonly fileName: string }
  | { readonly kind: "refused"; readonly refusal: DropRefusal; readonly message: string }
  | { readonly kind: "failed"; readonly message: string; readonly canRetry: boolean };

export type EmailState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly address: string }
  | { readonly kind: "sent"; readonly address: string; readonly again: boolean }
  | { readonly kind: "error"; readonly message: string };

const REFUSAL_TEXT: Readonly<Record<DropRefusal, string>> = {
  limit: DROP_COPY.limit,
  paused: DROP_COPY.paused,
  unavailable: DROP_COPY.unavailable,
  failed: DROP_COPY.failed,
};

export const dropBusy = (s: DropState) => s.kind === "checking" || s.kind === "uploading";

export function useGuestDrop(siteKey: string | null, mount: RefObject<HTMLDivElement | null>) {
  const [drop, setDrop] = useState<DropState>({ kind: "idle" });
  const [email, setEmail] = useState<EmailState>({ kind: "idle" });
  const [started, setStarted] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const chosen = useRef<File | null>(null);
  const queued = useRef<string | null>(null);

  useEffect(() => {
    if (!dropBusy(drop)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drop]);
  useEffect(() => () => controller.current?.abort(), []);

  // A cancel drops an address that was waiting for the upload to start.
  const discardQueued = useCallback(() => {
    if (queued.current === null) return;
    queued.current = null;
    setEmail((e) => (e.kind === "sending" ? { kind: "idle" } : e));
  }, []);

  const run = useCallback(
    async (file: File, container: "mp4" | "mov" | "webm") => {
      if (!siteKey || !mount.current) {
        setDrop({ kind: "refused", refusal: "unavailable", message: DROP_COPY.unavailable });
        return;
      }
      const abort = new AbortController();
      controller.current = abort;
      setStarted(false);
      setDrop({ kind: "checking", fileName: file.name });
      const token = await turnstileToken(siteKey, mount.current, abort.signal);
      if (abort.signal.aborted) {
        // Only this attempt may clear itself: a newer one keeps its own controller.
        if (controller.current === abort) controller.current = null;
        setDrop((s) => (s.kind === "checking" ? { kind: "idle" } : s));
        discardQueued();
        return;
      }
      if (!token) {
        controller.current = null;
        setDrop({ kind: "failed", message: DROP_COPY.failed, canRetry: true });
        return;
      }
      const guest = guestUploadIo(token);
      const outcome = await uploadFile(file, container, guest.io, abort.signal, {
        onStarted: () => {
          // The create request ignores the signal, so it can finish after a cancel.
          if (abort.signal.aborted) return;
          setStarted(true);
          setDrop({ kind: "uploading", fileName: file.name, percent: 0 });
        },
        onProgress: (percent) => setDrop((s) => (s.kind === "uploading" ? { ...s, percent } : s)),
      });
      controller.current = null;
      if (outcome.ok) return setDrop({ kind: "done", fileName: file.name });
      if (outcome.reason === "cancelled") {
        discardQueued();
        return setDrop({ kind: "idle" });
      }
      const code = guest.refusal();
      const refusal = refusalOf(code);
      // A refusal with a code shows its own screen; busy and bot check show the route's words.
      setDrop(
        code !== null && refusal !== "failed"
          ? { kind: "refused", refusal, message: REFUSAL_TEXT[refusal] }
          : { kind: "failed", message: outcome.message, canRetry: true },
      );
    },
    [siteKey, mount, discardQueued],
  );

  const choose = useCallback(
    (file: File | undefined) => {
      if (!file || controller.current) return;
      const check = checkGuestFile({ name: file.name, size: file.size, type: file.type });
      if (!check.ok) return setDrop({ kind: "rejected", message: check.message });
      chosen.current = file;
      void run(file, check.container);
    },
    [run],
  );

  const retry = useCallback(() => {
    const file = chosen.current;
    if (file) choose(file);
  }, [choose]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const send = useCallback(async (address: string, again: boolean) => {
    setEmail({ kind: "sending", address });
    const reply = await callApi("/api/guest/email", "POST", { email: address }).catch(() => null);
    if (reply?.status === 200) return setEmail({ kind: "sent", address, again });
    const data = reply?.data as { message?: unknown } | null | undefined;
    setEmail({
      kind: "error",
      message:
        typeof data?.message === "string"
          ? data.message
          : "We couldn't send the email. Please try again.",
    });
  }, []);

  // An address typed before the upload has started waits for the guest cookie, then goes.
  useEffect(() => {
    if (started && queued.current) {
      const address = queued.current;
      queued.current = null;
      void send(address, false);
    }
  }, [started, send]);

  const submitEmail = useCallback(
    (address: string, again = false) => {
      if (!started) {
        queued.current = address;
        setEmail({ kind: "sending", address });
        return;
      }
      void send(address, again);
    },
    [started, send],
  );

  const changeEmail = useCallback(() => setEmail({ kind: "idle" }), []);
  const reset = useCallback(() => setDrop({ kind: "idle" }), []);

  return { drop, email, choose, retry, cancel, reset, submitEmail, changeEmail };
}
