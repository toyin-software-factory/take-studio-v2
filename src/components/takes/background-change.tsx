"use client";

import { useEffect, useState } from "react";
import {
  type BackgroundItem,
  type BackgroundListData,
  ORIGINAL_BACKGROUND,
} from "@/lib/background-api";
import { selectOptions } from "@/lib/background-options";
import type { TakeDetail } from "@/lib/take-api";
import { BackgroundGrid } from "./background-grid";
import { BackgroundNotes, CleanEdgesTip } from "./background-notes";
import type { PlayerBridge } from "./player-bridge";
import { type CutReview, DELETED } from "./use-cut-review";
import { useBackgroundPreview } from "./use-background-preview";
import { useBackgroundUpload } from "./use-background-upload";
import { useBackgrounds } from "./use-backgrounds";
import { usePoster } from "./use-poster";

const NO_LIST: BackgroundListData = { builtIn: [], mine: [], defaultId: null };

/**
 * The background picker on the take page (spec 0008, AC-3 to AC-6, AC-11, AC-12): the grid, a
 * preview of the take on the chosen background shown on the stage, the notes and the clean
 * edges tip. A pick does not render: it joins the pending bar's changes (spec 0011 AC-5), and
 * Render there makes the video. The current and the chosen background stay visible even when the
 * list cannot be loaded.
 */
export function BackgroundChange({
  detail,
  bridge,
  review,
}: {
  readonly detail: TakeDetail;
  readonly bridge: PlayerBridge;
  readonly review: CutReview;
}) {
  const backgrounds = useBackgrounds();
  const [attempt, setAttempt] = useState(0);
  const upload = useBackgroundUpload(backgrounds.reload, review.pickBackground);
  const poster = usePoster(detail.take.id);
  const original = poster.url;

  const { take, background } = detail;
  const current = background ? (background.id ?? DELETED) : ORIGINAL_BACKGROUND;
  const pending = review.edits.background;
  const choice =
    pending !== undefined
      ? (pending ?? ORIGINAL_BACKGROUND)
      : current === DELETED
        ? ORIGINAL_BACKGROUND
        : current;
  const busy = review.locked;
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
    if (choice !== ORIGINAL_BACKGROUND && choice !== current) {
      review.rememberBackground(choice, chosenName);
    }
  }, [review, choice, current, chosenName]);
  useEffect(() => {
    if (overlayKind === "original" || overlayKind === "ready") {
      bridge.setPreview({
        kind: "image",
        url: overlayUrl ?? "",
        label: showOriginal ? "your original background" : chosenName,
      });
    } else if (overlayKind === "making") {
      bridge.setPreview({ kind: "making", label: chosenName });
    } else bridge.setPreview(null);
    return () => bridge.setPreview(null);
  }, [bridge, overlayKind, overlayUrl, showOriginal, chosenName]);
  // "Back to your video" picks the current background again: no preview, the video returns.
  useEffect(() => {
    bridge.setBack(() =>
      review.pickBackground(current === DELETED ? ORIGINAL_BACKGROUND : current),
    );
    return () => bridge.setBack(null);
  }, [bridge, review, current]);

  if (take.status !== "ready" || take.expired) return null;

  return (
    <section aria-labelledby="background-heading" className="flex flex-col gap-4">
      <h2 id="background-heading" className="text-h3 font-medium">
        Background
      </h2>
      <BackgroundNotes
        detail={detail}
        uncertain={false}
        previewNoGreen={preview.kind === "ready" && preview.noGreenScreen}
      />
      <BackgroundGrid
        group="take-background"
        list={list}
        extras={extras}
        original={{ thumbUrl: original, onThumbError: poster.refresh }}
        value={choice}
        onChange={review.pickBackground}
        mine={{
          state: upload.state,
          onFile: (file) => void upload.start(file),
          onDelete: (id) =>
            void upload.remove(id).then((deleted) => {
              if (!deleted) return;
              backgrounds.forget(id);
              if (choice === id) review.pickBackground(ORIGINAL_BACKGROUND);
            }),
        }}
      />
      {backgrounds.state.kind === "failed" ? (
        <p role="status" className="text-small text-muted-foreground">
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
      <CleanEdgesTip />
    </section>
  );
}
