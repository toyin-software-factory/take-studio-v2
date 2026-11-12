"use client";

import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { BackgroundItem } from "@/lib/background-api";
import { backgroundFailureMessage } from "@/lib/background-rules";
import { BackgroundTile } from "./background-tile";
import type { BackgroundUploadState } from "./use-background-upload";

export type MineActions = {
  readonly state: BackgroundUploadState;
  readonly onFile: (file: File) => void;
  readonly onDelete: (id: string) => void;
};

/**
 * "Your backgrounds" (spec 0008, AC-8, AC-10): the creator's ready uploads as tiles with a Delete
 * button, the upload tile, and one line for each image still being processed or refused (with
 * the friendly reason). Kept small; the full library view comes with the take page picker.
 */
export function BackgroundMine({
  items,
  value,
  onChange,
  group,
  actions,
}: {
  readonly items: readonly BackgroundItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly group: string;
  readonly actions: MineActions;
}) {
  const working = actions.state.kind === "working";
  return (
    <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
      <h3 id="mine-heading" className="text-body font-medium">
        Your backgrounds
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {items
          .filter((item) => item.status === "ready")
          .map((item) => (
            <div key={item.id} className="flex flex-col items-start gap-1">
              <BackgroundTile
                group={group}
                value={item.id}
                name={item.name}
                alt={item.alt}
                thumbUrl={item.thumbUrl}
                checked={value === item.id}
                onSelect={() => onChange(item.id)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.onDelete(item.id)}
                aria-label={`Delete ${item.name}`}
              >
                Delete
              </Button>
            </div>
          ))}
        <label className="relative flex aspect-video cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border-strong bg-card text-small has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid pointer-coarse:min-h-11">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={working}
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) actions.onFile(file);
              event.currentTarget.value = "";
            }}
          />
          <Icon
            icon={working ? Loader2 : Plus}
            size="ui"
            className={working ? "animate-spin motion-reduce:animate-none" : undefined}
          />
          <span>
            {actions.state.kind === "working"
              ? actions.state.step === "uploading"
                ? "Uploading"
                : "Processing"
              : "Upload image"}
          </span>
        </label>
      </div>
      <div aria-live="polite" className="flex flex-col gap-1 text-small">
        {actions.state.kind === "failed" ? (
          <p role="alert" className="text-danger">
            {actions.state.message}
          </p>
        ) : null}
        {items
          .filter((item) => item.status !== "ready")
          .map((item) => (
            <p key={item.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span className="font-medium text-text">{item.name}</span>
              {item.status === "processing" ? (
                <span>Processing</span>
              ) : (
                <>
                  {/* Failed, or still `uploading`: the file never arrived or the page closed. */}
                  <span>
                    {item.status === "failed"
                      ? backgroundFailureMessage(item.failureCode)
                      : "This upload didn't finish."}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => actions.onDelete(item.id)}>
                    Remove
                  </Button>
                </>
              )}
            </p>
          ))}
      </div>
    </section>
  );
}
