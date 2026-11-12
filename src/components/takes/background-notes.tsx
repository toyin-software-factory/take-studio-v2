import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import {
  NO_GREEN_SCREEN_NOTE,
  backgroundChangeActive,
  backgroundFailureMessage,
} from "@/lib/take-display";
import type { TakeDetail } from "@/lib/take-api";

/**
 * What the take page says around the picker (spec 0008, AC-3, AC-4, AC-5, AC-11): the skip note
 * when the video was kept on its own background, progress while a new one is made (the current
 * video keeps playing), why a change failed, and the clean edges tip.
 */
export function BackgroundNotes({
  detail,
  uncertain,
  previewNoGreen,
}: {
  readonly detail: TakeDetail;
  /** The start's outcome could not be confirmed, and looking again failed too. */
  readonly uncertain: boolean;
  /** The preview found no green screen (AC-4): choosing a background will change nothing. */
  readonly previewNoGreen: boolean;
}) {
  const { background, backgroundJob, noGreenScreen } = detail;
  const failed = backgroundJob?.status === "failed";
  return (
    <>
      <p className="text-small">Now: {background ? background.name : "your original background"}</p>
      {noGreenScreen ? <Alert variant="info" title={NO_GREEN_SCREEN_NOTE} /> : null}
      {previewNoGreen ? (
        <Alert
          variant="info"
          title="We couldn't find a green screen in this take, so this background wouldn't show."
        />
      ) : null}
      {backgroundChangeActive(backgroundJob) ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Icon icon={Loader2} size="badge" className="animate-spin motion-reduce:animate-none" />
          Making your video with the new background. You can keep watching this one.
        </p>
      ) : null}
      {failed ? (
        <Alert variant="warning" title={backgroundFailureMessage(backgroundJob.failureCode)} />
      ) : null}
      {uncertain && !backgroundChangeActive(backgroundJob) ? (
        <p role="alert" className="text-danger">
          We couldn&rsquo;t confirm the change started. Check back in a moment, or try again.
        </p>
      ) : null}
    </>
  );
}

/** The short tip near the picker (AC-11). */
export function CleanEdgesTip() {
  return (
    <p className="text-small text-muted-foreground">
      Getting clean edges: use even light with no shadows on the green, and stand a step away from
      it.
    </p>
  );
}
