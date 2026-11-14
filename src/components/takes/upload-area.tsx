"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Upload, Video } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UploadNote } from "@/components/legal/legal-notice";
import { Icon } from "@/components/ui/icon";
import { ORIGINAL_BACKGROUND } from "@/lib/background-api";
import { cn } from "@/lib/utils";
import { BackgroundSelect } from "./background-select";
import { UploadProgress } from "./upload-progress";
import { useBackgrounds } from "./use-backgrounds";
import { useUpload } from "./use-upload";
import { useUsage } from "./use-usage";
import { UsageMeter, usedUpMessage, type UsageView } from "./usage-meter";

/** ID of the hidden file input, so "Upload another video" elsewhere can open the picker. */
export const UPLOAD_INPUT_ID = "upload-video-input";

const LIMITS = "MP4 or MOV, up to 10 minutes, 2 GB, 1080p";

/**
 * The library's upload area (spec 0004, AC-1 to AC-3; design.md Upload dropzone): a dashed
 * drop zone with one "Choose a video" button and the limits underneath. States: idle,
 * dragging, uploading (progress, Cancel), completing, rejected (inline alert), cancelled.
 */
export function UploadArea({ usage: firstUsage = null }: { readonly usage?: UsageView | null }) {
  const { state, start, cancel, busy } = useUpload();
  // A refused or cancelled upload may have changed what is left, so read the numbers again.
  const usage = useUsage(firstUsage, state.kind === "idle" ? "" : state.kind);
  // The limit only blocks when it is switched on (off in production until the reconcile).
  const blocked = usage !== null && usage.enforced && usage.remainingSeconds <= 0;
  const backgrounds = useBackgrounds();
  // The creator's own choice on this page; until they pick, their last pick is used.
  const [picked, setPicked] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const effectiveChoice = () =>
    // Nothing is sent until the list has loaded, so a slow or failed read changes nothing.
    backgrounds.state.kind === "ready"
      ? (picked ?? backgrounds.state.list.defaultId ?? ORIGINAL_BACKGROUND)
      : undefined;

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !blocked) void start(file, effectiveChoice());
  };

  return (
    <section aria-labelledby="upload-heading" className="flex flex-col gap-3">
      <h2 id="upload-heading" className="sr-only">
        Upload a video
      </h2>
      {state.kind === "rejected" ? (
        <Alert variant="danger" title="This video can't be uploaded">
          {state.message}
        </Alert>
      ) : null}
      {state.kind === "cancelled" ? (
        <Alert title="Upload cancelled">Nothing was saved.</Alert>
      ) : null}

      {usage?.enforced ? <UsageMeter usage={usage} /> : null}

      {busy ? (
        <UploadProgress state={state} onCancel={cancel} />
      ) : (
        <div
          data-testid="dropzone"
          data-dragging={dragging || undefined}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!blocked) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            take(event.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-panel px-4 py-10 text-center transition-colors duration-300 ease-ui",
            dragging && !blocked && "border-primary bg-selected-surface",
          )}
        >
          <Icon icon={Upload} size="empty" className="text-muted-foreground" />
          <p id="upload-prompt" className="text-h4">
            {blocked && usage
              ? usedUpMessage(usage)
              : dragging
                ? "Drop to upload"
                : "Drop a video here, or"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              disabled={blocked}
              aria-describedby={blocked ? "upload-prompt" : undefined}
              onClick={() => input.current?.click()}
            >
              Choose a video
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/record">
                <Icon icon={Video} /> Record
              </Link>
            </Button>
          </div>
          <p className="text-small text-muted-foreground">{LIMITS}</p>
          <UploadNote />
          <BackgroundSelect
            backgrounds={backgrounds}
            picked={picked}
            onPick={setPicked}
            onForget={(id) => setPicked((now) => (now === id ? ORIGINAL_BACKGROUND : now))}
          />
          <input
            ref={input}
            id={UPLOAD_INPUT_ID}
            type="file"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a video"
            disabled={blocked}
            onChange={(event) => {
              take(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </div>
      )}
    </section>
  );
}
