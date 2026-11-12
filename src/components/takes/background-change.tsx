"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type BackgroundItem,
  type BackgroundListData,
  ORIGINAL_BACKGROUND,
} from "@/lib/background-api";
import { selectOptions } from "@/lib/background-options";
import type { TakeDetail } from "@/lib/take-api";
import { backgroundChangeActive } from "@/lib/take-display";
import { BackgroundGrid } from "./background-grid";
import { BackgroundNotes, CleanEdgesTip } from "./background-notes";
import type { PlayerBridge } from "./player-bridge";
import type { PollResult } from "./use-poll";
import { useBackgroundPreview } from "./use-background-preview";
import { useBackgroundStart } from "./use-background-start";
import { useBackgroundUpload } from "./use-background-upload";
import { useBackgrounds } from "./use-backgrounds";
import { usePoster } from "./use-poster";

const NO_LIST: BackgroundListData = { builtIn: [], mine: [], defaultId: null };
/** Stands for "keyed on a background that was deleted": not the original, and nothing to pick. */
const DELETED = "deleted";

/**
 * The background picker on the take page (spec 0008, AC-3 to AC-6, AC-11, AC-12): the grid, a
 * preview of the take on the chosen background shown on the stage, "Use this background" (or
 * "Keep original"), progress while a new video is made (the current one keeps playing), the
 * notes, "Try again" after a failure (repeating the failed target) and the clean edges tip. The
 * current and the chosen background stay visible even when the list cannot be loaded.
 */
export function BackgroundChange({
  detail,
  bridge,
  onStarted,
  onUncertain,
}: {
  readonly detail: TakeDetail;
  readonly bridge: PlayerBridge;
  /** The change started: `target` is the background asked for (null is the original). */
  readonly onStarted: (target: string | null) => void;
  /** The PUT's outcome is unknown (the response was lost): look at the take again. */
  readonly onUncertain: () => Promise<PollResult>;
}) {
  const backgrounds = useBackgrounds();
  const [picked, setPicked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const upload = useBackgroundUpload(backgrounds.reload, setPicked);
  const original = usePoster(detail.take.id);

  const { take, background, backgroundJob } = detail;
  const failed = backgroundJob?.status === "failed";
  const current = background ? (background.id ?? DELETED) : ORIGINAL_BACKGROUND;
  const retryTarget = failed ? (backgroundJob.targetBackgroundId ?? ORIGINAL_BACKGROUND) : null;
  const choice = picked ?? retryTarget ?? (current === DELETED ? ORIGINAL_BACKGROUND : current);
  // "Try again" only while the choice is the failed target; another pick is a new change.
  const retrying = failed && choice === (retryTarget ?? ORIGINAL_BACKGROUND);
  const start = useBackgroundStart(take.id, choice, onStarted, onUncertain);
  // The last render found no green screen: a real background would show nowhere (the server
  // refuses it too), so only "Keep original" can be used. The note above says why.
  const noGreen = detail.noGreenScreen && choice !== ORIGINAL_BACKGROUND;
  const busy = start.starting || backgroundChangeActive(backgroundJob);
  const list = backgrounds.state.kind === "ready" ? backgrounds.state.list : NO_LIST;
  const listed = [...list.builtIn, ...list.mine].filter((b) => b.status === "ready");
  const extras: BackgroundItem[] = selectOptions(listed, background, choice)
    .filter((o) => !listed.some((l) => l.id === o.id))
    .map((o) => ({
      id: o.id,
      name: o.name,
      alt: o.name,
      status: "ready",
      failureCode: null,
      thumbUrl: null,
    }));
  const chosenName = listed.concat(extras).find((b) => b.id === choice)?.name ?? "this background";

  const previewing = take.status === "ready" && !take.expired && !busy && choice !== current;
  const preview = useBackgroundPreview(take.id, choice, previewing, attempt);
  const showOriginal = previewing && choice === ORIGINAL_BACKGROUND && original !== null;
  const overlayKind = showOriginal ? "original" : preview.kind;
  const overlayUrl = showOriginal ? original : preview.kind === "ready" ? preview.url : "";
  useEffect(() => {
    if (overlayKind === "original" || overlayKind === "ready") {
      bridge.setPreview({
        kind: "image",
        url: overlayUrl ?? "",
        label: showOriginal ? "your original background" : chosenName,
      });
    } else if (overlayKind === "making") bridge.setPreview({ kind: "making", label: chosenName });
    else bridge.setPreview(null);
    return () => bridge.setPreview(null);
  }, [bridge, overlayKind, overlayUrl, showOriginal, chosenName]);

  if (take.status !== "ready" || take.expired) return null;

  return (
    <section aria-labelledby="background-heading" className="flex flex-col gap-4">
      <h2 id="background-heading" className="text-h3 font-semibold">
        Background
      </h2>
      <BackgroundNotes
        detail={detail}
        uncertain={start.uncertain}
        previewNoGreen={preview.kind === "ready" && preview.noGreenScreen}
      />
      <BackgroundGrid
        group="take-background"
        list={list}
        extras={extras}
        value={choice}
        onChange={setPicked}
        mine={{
          state: upload.state,
          onFile: (file) => void upload.start(file),
          onDelete: (id) =>
            void upload.remove(id).then((deleted) => {
              if (!deleted) return;
              backgrounds.forget(id);
              // The pick, or the failed target the section falls back to when nothing was picked.
              setPicked((now) =>
                now === id || (now === null && retryTarget === id) ? ORIGINAL_BACKGROUND : now,
              );
            }),
        }}
      />
      {backgrounds.state.kind === "failed" ? (
        <p role="status" className="text-small text-text-muted">
          We couldn&rsquo;t load your backgrounds, so only the current one is shown.{" "}
          <button
            type="button"
            onClick={backgrounds.reload}
            className="underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : null}
      {preview.kind === "failed" ? (
        <p role="alert" className="text-danger">
          {preview.message}{" "}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="underline underline-offset-2"
          >
            Try the preview again
          </button>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={start.change}
          loading={start.starting}
          disabled={busy || noGreen || (choice === current && !retrying)}
        >
          {retrying
            ? "Try again"
            : choice === ORIGINAL_BACKGROUND
              ? "Keep original"
              : "Use this background"}
        </Button>
      </div>
      {start.checking ? (
        <p role="status">We couldn&rsquo;t confirm the change started. Checking now.</p>
      ) : null}
      {start.error ? <p role="alert">{start.error}</p> : null}
      <CleanEdgesTip />
    </section>
  );
}
