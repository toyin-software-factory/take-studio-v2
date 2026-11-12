"use client";

import { ChevronDown, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ORIGINAL_BACKGROUND, findBackground } from "@/lib/background-api";
import { BackgroundPicker } from "./background-picker";
import { useBackgroundUpload } from "./use-background-upload";
import type { useBackgrounds } from "./use-backgrounds";

/**
 * The upload area's compact "Background" select (spec 0008, AC-1): the current pick's thumbnail
 * and name, opening the picker dialog. The choice is the one the creator made, else their last
 * pick from the database, else "Keep original" (also while the list loads or fails to load).
 */
export function BackgroundSelect({
  backgrounds,
  picked,
  onPick,
  disabled,
}: {
  readonly backgrounds: ReturnType<typeof useBackgrounds>;
  /** The creator's own choice on this page, or null to use their last pick. */
  readonly picked: string | null;
  readonly onPick: (id: string) => void;
  readonly disabled?: boolean;
}) {
  const { state, reload } = backgrounds;
  const upload = useBackgroundUpload(reload, onPick);
  const list = state.kind === "ready" ? state.list : null;
  const value = picked ?? list?.defaultId ?? ORIGINAL_BACKGROUND;
  const current = findBackground(list, value);

  const trigger = (
    <Button
      variant="secondary"
      disabled={disabled || !list}
      loading={state.kind === "loading"}
      aria-haspopup="dialog"
      className="h-auto min-h-11 gap-3 py-2"
    >
      <span className="relative flex aspect-video w-14 items-center justify-center overflow-hidden rounded-sm bg-muted">
        {current?.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 link
          <img src={current.thumbUrl} alt="" className="size-full object-cover" />
        ) : (
          <Icon icon={ImageOff} size="badge" className="text-text-muted" />
        )}
      </span>
      <span className="flex flex-col items-start text-left leading-tight">
        <span className="text-small text-text-muted">Background</span>
        <span>{current?.name ?? "Keep original"}</span>
      </span>
      <Icon icon={ChevronDown} size="badge" />
    </Button>
  );

  return (
    <div className="flex flex-col items-center gap-1">
      {list ? (
        <BackgroundPicker
          trigger={trigger}
          list={list}
          value={value}
          onChange={onPick}
          mine={{
            state: upload.state,
            onFile: (f) => void upload.start(f),
            onDelete: (id) => void upload.remove(id),
          }}
        />
      ) : (
        trigger
      )}
      {state.kind === "failed" ? (
        <p role="status" className="text-small text-text-muted">
          We couldn&rsquo;t load the backgrounds. You can still upload and keep your original.{" "}
          <button type="button" onClick={reload} className="underline underline-offset-2">
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
