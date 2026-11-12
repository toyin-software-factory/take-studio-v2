"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type TakeDetail, apiMessage } from "@/lib/take-api";
import {
  NO_GREEN_SCREEN_NOTE,
  backgroundChangeActive,
  backgroundFailureMessage,
} from "@/lib/take-display";
import { callApi } from "./browser-io";

const ORIGINAL = "original";

/** The built in studios, as `GET /api/backgrounds` lists them (only what this select needs). */
const listSchema = z.object({
  builtIn: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
});

/**
 * A plain way to change a ready take's background (spec 0008, AC-5, AC-6): a select and a
 * button. The picker with thumbnails and previews is a later part. The take stays Ready and its
 * video playable while the new one is made; `onStarted` makes the page poll again.
 */
export function BackgroundChange({
  detail,
  onStarted,
}: {
  readonly detail: TakeDetail;
  readonly onStarted: () => void;
}) {
  const [options, setOptions] = useState<readonly { id: string; name: string }[]>([]);
  const [choice, setChoice] = useState<string>(detail.background?.id ?? ORIGINAL);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callApi("/api/backgrounds", "GET")
      .then((reply) => {
        const parsed = listSchema.safeParse(reply.data);
        if (!cancelled && reply.status === 200 && parsed.success) {
          setOptions(parsed.data.builtIn.filter((b) => b.status === "ready"));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const { take, background, backgroundJob, noGreenScreen } = detail;
  if (take.status !== "ready" || take.expired) return null;
  const busy = starting || backgroundChangeActive(backgroundJob);
  const current = background?.id ?? ORIGINAL;

  const change = async () => {
    setStarting(true);
    setError(null);
    try {
      const reply = await callApi(`/api/takes/${take.id}/background`, "PUT", {
        backgroundId: choice,
      });
      if (reply.status === 202) onStarted();
      else setError(apiMessage(reply.data, "The change didn't start. Please try again."));
    } catch {
      setError("The change didn't start. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <section aria-labelledby="background-heading" className="flex flex-col gap-3">
      <h2 id="background-heading" className="text-h3 font-semibold">
        Background
      </h2>
      <p className="text-small">Now: {background ? background.name : "your original background"}</p>
      {noGreenScreen ? <Alert variant="info" title={NO_GREEN_SCREEN_NOTE} /> : null}
      {backgroundChangeActive(backgroundJob) ? (
        <p role="status">
          Making your video with the new background. You can keep watching this one.
        </p>
      ) : null}
      {backgroundJob?.status === "failed" ? (
        <Alert variant="warning" title={backgroundFailureMessage(backgroundJob.failureCode)} />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="background-choice" className="text-small font-medium">
          Change to
        </label>
        <select
          id="background-choice"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={busy}
          className="min-h-11 rounded-md border border-border bg-background px-3 text-small"
        >
          <option value={ORIGINAL}>Keep original</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={change}
          disabled={busy || (choice === current && backgroundJob?.status !== "failed")}
        >
          {backgroundJob?.status === "failed" ? "Try again" : "Use this background"}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <p className="text-small text-muted-foreground">
        Tip: for clean edges, use even light with no shadows on the green, and stand a step away
        from it.
      </p>
    </section>
  );
}
