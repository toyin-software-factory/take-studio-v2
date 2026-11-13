"use client";

import { useCallback, useState } from "react";
import { z } from "zod";
import { type Edits, changeBody } from "@/lib/cut-review";
import { CHANGE_MESSAGES, type ChangeErrorCode } from "@/lib/change-messages";
import { callApi } from "./browser-io";
import { type PollResult, usePoll } from "./use-poll";

const errorSchema = z.object({ error: z.string(), message: z.string().optional() });
const jobSchema = z.object({ status: z.string() });
const jobStarted = z.object({ jobId: z.string() });

/** What the render button is doing (spec 0011, AC-6). `frozen` is the edits as they were at the press. */
export type RenderPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly frozen: Edits }
  | { readonly kind: "rendering"; readonly jobId: string; readonly frozen: Edits }
  | { readonly kind: "done" }
  | { readonly kind: "failed" };

function refusalMessage(data: unknown): { code: string | null; message: string } {
  const parsed = errorSchema.safeParse(data);
  if (!parsed.success) return { code: null, message: CHANGE_MESSAGES.dispatch_failed };
  const known = parsed.data.error in CHANGE_MESSAGES;
  return {
    code: parsed.data.error,
    message: known
      ? CHANGE_MESSAGES[parsed.data.error as ChangeErrorCode]
      : (parsed.data.message ?? CHANGE_MESSAGES.dispatch_failed),
  };
}

/**
 * Starts one free render with the pending changes and follows its own job by id (spec 0011, AC-6,
 * AC-8): `POST /changes` with `baseRenderId`, then `GET /jobs/{jobId}` until it ends. Success
 * resets the page (`onSucceeded`), failure or cancel gives the edits back with "Try again", a
 * refusal shows its message (409 `stale` also reloads, 429 hides Render until the page reloads,
 * 409 `original_gone` makes the page read only). A lost response reloads the take to look.
 */
export function useChangeRender(
  takeId: string,
  baseRenderId: string | null,
  hooks: {
    readonly reload: () => Promise<PollResult>;
    readonly onSucceeded: () => void;
    readonly onOriginalGone: () => void;
  },
) {
  const [phase, setPhase] = useState<RenderPhase>({ kind: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const { reload, onSucceeded, onOriginalGone } = hooks;

  const start = useCallback(
    async (edits: Edits) => {
      if (!baseRenderId) return;
      setMessage(null);
      setPhase({ kind: "starting", frozen: edits });
      try {
        const reply = await callApi(
          `/api/takes/${takeId}/changes`,
          "POST",
          changeBody(baseRenderId, edits),
        );
        const started = jobStarted.safeParse(reply.data);
        if (reply.status === 202 && started.success) {
          setPhase({ kind: "rendering", jobId: started.data.jobId, frozen: edits });
          return;
        }
        const { code, message: text } = refusalMessage(reply.data);
        setPhase({ kind: "idle" });
        setMessage(text);
        if (code === "change_limit") setLimited(true);
        if (code === "original_gone") onOriginalGone();
        // Stale, a running job or a moved take: the page is out of date, so read it again.
        if (reply.status === 409 || reply.status === 404) void reload();
      } catch {
        setPhase({ kind: "idle" });
        setMessage("We couldn't confirm the render started. Checking now.");
        void reload();
      }
    },
    [takeId, baseRenderId, reload, onOriginalGone],
  );

  const tick = useCallback(async (): Promise<PollResult> => {
    if (phase.kind !== "rendering") return "stop";
    const reply = await callApi(`/api/takes/${takeId}/jobs/${phase.jobId}`, "GET").catch(
      () => null,
    );
    const job = jobSchema.safeParse(reply?.data);
    // Signed out or the job is gone: polling again cannot help.
    if (reply?.status === 401 || reply?.status === 404) {
      void reload();
      setPhase({ kind: "failed" });
      return "stop";
    }
    if (reply?.status !== 200 || !job.success) return "error";
    if (job.data.status === "succeeded") {
      const fresh = await reload();
      // The edits are cleared only once the page has read the new render.
      if (fresh === "error") return "error";
      setPhase({ kind: "done" });
      onSucceeded();
      return "stop";
    }
    if (job.data.status === "failed" || job.data.status === "cancelled") {
      await reload();
      setPhase({ kind: "failed" });
      return "stop";
    }
    return "continue";
  }, [takeId, phase, reload, onSucceeded]);

  usePoll(tick, 2000, phase.kind === "rendering");

  return {
    phase,
    message,
    limited,
    start,
    clearMessage: useCallback(() => {
      setMessage(null);
      setPhase((p) => (p.kind === "done" || p.kind === "failed" ? { kind: "idle" } : p));
    }, []),
  };
}
