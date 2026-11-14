"use client";

import { useState } from "react";
import { UploadProgress } from "@/components/takes/upload-progress";
import { useLeaveGuard } from "@/components/takes/use-leave-guard";
import { useUpload } from "@/components/takes/use-upload";
import { wouldLoseWork } from "@/lib/recorder-state";
import type { RecordingContainer } from "@/lib/recorder-rules";
import { RecordReview } from "./record-review";
import { RecordSetup } from "./record-setup";
import { RecordStage } from "./record-stage";
import { useRecorder } from "./use-recorder";

/** The container a file name ends in (the recorder named it from the type it picked). */
const containerOf = (fileName: string): RecordingContainer =>
  fileName.endsWith(".mp4") ? "mp4" : "webm";

const LEAVE_MESSAGE = "Your recording hasn't been uploaded. Leave without it?";

/**
 * The /record page (spec 0021 task 1): setup with an optional script, a mirrored preview, a
 * 3 second countdown, record, stop, then review. "Use this take" goes through the normal
 * upload and ends on the take page. Nothing leaves the device before that.
 */
export function RecordView() {
  const recorder = useRecorder();
  const upload = useUpload();
  const [script, setScript] = useState("");
  const { state, dispatch } = recorder;
  // Links and Back ask first too, not only closing the tab (the recorder warns for that).
  useLeaveGuard(wouldLoseWork(state), LEAVE_MESSAGE);

  const submitTake = async () => {
    if (state.kind !== "review" && state.kind !== "upload_failed") return;
    const { take } = state;
    dispatch({ type: "upload" });
    const file = new File([take.blob], take.fileName, { type: take.blob.type });
    const outcome = await upload.startRecording(file, containerOf(take.fileName), script);
    if (outcome && !outcome.ok) {
      dispatch({
        type: "upload_failed",
        message: outcome.reason === "cancelled" ? "The upload was cancelled." : outcome.message,
      });
    }
  };

  if (state.kind === "uploading")
    return <UploadProgress state={upload.state} onCancel={upload.cancel} />;
  if (state.kind === "review" || state.kind === "upload_failed") {
    return (
      <RecordReview
        take={state.take}
        failure={state.kind === "upload_failed" ? state.message : null}
        onUse={() => void submitTake()}
        onAgain={() => void recorder.again()}
      />
    );
  }
  if (state.kind === "ready" || state.kind === "countdown" || state.kind === "recording") {
    return (
      <RecordStage
        state={state}
        stream={recorder.stream}
        script={script}
        elapsedMs={recorder.elapsedMs}
        limitMs={recorder.limitMs}
        onRecord={recorder.begin}
        onStop={recorder.stop}
      />
    );
  }
  return (
    <RecordSetup
      script={script}
      onScript={setScript}
      failure={state.kind === "failed" ? state.failure : null}
      busy={state.kind === "requesting"}
      onStart={() => void recorder.request()}
    />
  );
}
