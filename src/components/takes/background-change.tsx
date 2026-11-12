"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ORIGINAL_BACKGROUND, backgroundListSchema } from "@/lib/background-api";
import { selectOptions } from "@/lib/background-options";
import { type TakeDetail, apiMessage } from "@/lib/take-api";
import {
  NO_GREEN_SCREEN_NOTE,
  backgroundChangeActive,
  backgroundFailureMessage,
} from "@/lib/take-display";
import { callApi } from "./browser-io";

const ORIGINAL = ORIGINAL_BACKGROUND;

/**
 * A plain way to change a ready take's background (spec 0008, AC-5, AC-6): a select and a
 * button. The picker with thumbnails and previews is a later part. The take stays Ready and its
 * video playable while the new one is made; `onStarted` makes the page poll again.
 */
/** Stands for "keyed on a background that was deleted": not the original, and nothing to pick. */
const DELETED = "deleted";

export function BackgroundChange({
  detail,
  onStarted,
  onUncertain,
}: {
  readonly detail: TakeDetail;
  /** The change started: `target` is the background asked for (null is the original). */
  readonly onStarted: (target: string | null) => void;
  /** The PUT's outcome is unknown (the response was lost): look at the take again. */
  readonly onUncertain: () => Promise<unknown>;
}) {
  const [options, setOptions] = useState<readonly { id: string; name: string }[]>([]);
  // What the creator picked; null until they touch the select.
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while the page looks at the take again after a PUT whose outcome is unknown.
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void callApi("/api/backgrounds", "GET")
      .then((reply) => {
        const parsed = backgroundListSchema.safeParse(reply.data);
        if (!cancelled && reply.status === 200 && parsed.success) {
          setOptions(
            [...parsed.data.builtIn, ...parsed.data.mine].filter((b) => b.status === "ready"),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const { take, background, backgroundJob, noGreenScreen } = detail;
  const jobActive = backgroundChangeActive(backgroundJob);
  if (take.status !== "ready" || take.expired) return null;
  const busy = starting || jobActive;
  // What the video is on now. A keyed render whose background was deleted is its own state, so
  // "Keep original" stays available for it.
  const current = background ? (background.id ?? DELETED) : ORIGINAL;
  const failed = backgroundJob?.status === "failed";
  // After a failed change "Try again" repeats that change, not the current background.
  const retryTarget = failed ? (backgroundJob.targetBackgroundId ?? ORIGINAL) : null;
  const choice = picked ?? retryTarget ?? (current === DELETED ? ORIGINAL : current);

  const change = async () => {
    setStarting(true);
    setError(null);
    const target = choice === ORIGINAL ? null : choice;
    try {
      const reply = await callApi(`/api/takes/${take.id}/background`, "PUT", {
        backgroundId: choice,
      });
      if (reply.status === 202) onStarted(target);
      else setError(apiMessage(reply.data, "The change didn't start. Please try again."));
    } catch {
      // The request may have reached the server: look before saying anything is wrong. The
      // message lives only while we look; afterwards the page shows what the take really is.
      setChecking(true);
      try {
        await onUncertain();
      } finally {
        setChecking(false);
      }
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
      {failed ? (
        <Alert variant="warning" title={backgroundFailureMessage(backgroundJob.failureCode)} />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="background-choice" className="text-small font-medium">
          Change to
        </label>
        <select
          id="background-choice"
          value={choice}
          onChange={(e) => setPicked(e.target.value)}
          disabled={busy}
          className="min-h-11 rounded-md border border-border bg-background px-3 text-small"
        >
          <option value={ORIGINAL}>Keep original</option>
          {selectOptions(options, background, choice).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button type="button" onClick={change} disabled={busy || (choice === current && !failed)}>
          {failed ? "Try again" : "Use this background"}
        </Button>
      </div>
      {checking ? (
        <p role="status">We couldn&rsquo;t confirm the change started. Checking now.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <p className="text-small text-muted-foreground">
        Tip: for clean edges, use even light with no shadows on the green, and stand a step away
        from it.
      </p>
    </section>
  );
}
