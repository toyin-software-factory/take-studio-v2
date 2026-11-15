"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usedUpMessage, type UsageView } from "@/components/takes/usage-meter";
import { useUsage } from "@/components/takes/use-usage";
import { UploadProgress } from "@/components/takes/upload-progress";
import { useIdle } from "@/components/takes/use-idle";
import { useLeaveGuard } from "@/components/takes/use-leave-guard";
import { useUpload } from "@/components/takes/use-upload";
import { holdCountdown } from "@/lib/follow-state";
import { wouldLoseWork } from "@/lib/recorder-state";
import { clearDraft, deviceStore, loadDraft, saveDraft } from "@/lib/prompter-storage";
import { usageDisplay } from "@/lib/usage-rules";
import { isUsedUp, usageLimitSeconds, type RecordingContainer } from "@/lib/recorder-rules";
import { RecordSetup } from "./record-setup";
import { RecordReview } from "./record-review";
import { RecordStage, preloadSteps } from "./lazy-steps";
import { RecordSteps } from "./steps";
import { usePrompter } from "./use-prompter";
import { useRecorder } from "./use-recorder";
import { useVoiceFollow } from "./use-voice-follow";

/** The container a file name ends in (the recorder named it from the type it picked). */
const containerOf = (fileName: string): RecordingContainer =>
  fileName.endsWith(".mp4") ? "mp4" : "webm";

/** A touch screen as the main input (a phone or tablet). Read in the browser only. */
const isTouchDevice = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const LEAVE_MESSAGE = "Your recording hasn't been uploaded. Leave without it?";

/**
 * The /record page (spec 0021 task 1): setup with an optional script, a mirrored preview, a
 * 3 second countdown, record, stop, then review. "Use this take" goes through the normal
 * upload and ends on the take page. Nothing leaves the device before that.
 */
export function RecordView({
  usage: firstUsage = null,
  creatorId,
}: {
  readonly usage?: UsageView | null;
  readonly creatorId: string;
}) {
  const [usageKey, setUsageKey] = useState("");
  const usage = useUsage(firstUsage, usageKey);
  // The countdown waits at 0 while the voice service connects (set below, once its status is known).
  const [holdForVoice, setHoldForVoice] = useState(false);
  const recorder = useRecorder(usageLimitSeconds(usage), holdForVoice);
  const upload = useUpload();
  const [script, setScript] = useState("");
  const idle = useIdle(1500);
  useEffect(() => {
    if (idle) preloadSteps();
  }, [idle]);
  const { state, dispatch } = recorder;
  // Links and Back ask first too, not only closing the tab (the recorder warns for that).
  // A phone's own camera file uploading (upload.busy) is lost on leaving too.
  useLeaveGuard(wouldLoseWork(state) || upload.busy, LEAVE_MESSAGE);
  const onStage =
    state.kind === "ready" || state.kind === "countdown" || state.kind === "recording";
  const prompter = usePrompter(script, creatorId, state.kind === "recording", onStage);
  const followOn = prompter.settings.follow && prompter.total > 0;
  const follow = useVoiceFollow({
    script,
    stream: recorder.stream,
    enabled: followOn,
    countdown: state.kind === "countdown",
    recording: state.kind === "recording",
    startWord: prompter.getPosition,
  });
  const hold =
    state.kind === "countdown" &&
    state.secondsLeft === 0 &&
    holdCountdown({ enabled: followOn, status: follow.status, heldMs: 0 });
  // Adjusting state while rendering: React re-renders at once, before anything is drawn.
  if (hold !== holdForVoice) setHoldForVoice(hold);
  // The prompter stands still at its first line while the voice service connects.
  const { setStill } = prompter;
  useEffect(() => {
    setStill(followOn && follow.status === "connecting");
  }, [setStill, followOn, follow.status]);

  // The script draft is remembered on this device and cleared once the take is created.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reading device storage after hydration
  useEffect(() => setScript(loadDraft(deviceStore(), creatorId)), [creatorId]);
  const editScript = (next: string) => {
    setScript(next);
    saveDraft(deviceStore(), creatorId, next);
  };

  const submitTake = async () => {
    if (state.kind !== "review" && state.kind !== "upload_failed") return;
    const { take } = state;
    dispatch({ type: "upload" });
    const file = new File([take.blob], take.fileName, { type: take.blob.type });
    const outcome = await upload.startRecording(
      file,
      containerOf(take.fileName),
      script,
      undefined,
      take.durationMs,
    );
    if (outcome?.ok) clearDraft(deviceStore(), creatorId);
    if (outcome && !outcome.ok) {
      // A refused take may mean the numbers changed: read them again (the recording stays).
      setUsageKey(String(Date.now()));
      dispatch({
        type: "upload_failed",
        message: outcome.reason === "cancelled" ? "The upload was cancelled." : outcome.message,
      });
    }
  };

  if (state.kind === "uploading" || state.kind === "review" || state.kind === "upload_failed") {
    return (
      <WithSteps step={3}>
        <RecordReview
          take={state.take}
          failure={state.kind === "upload_failed" ? state.message : null}
          upload={state.kind === "uploading" ? upload.state : null}
          onUse={() => void submitTake()}
          onAgain={() => void recorder.again()}
          onCancel={upload.cancel}
        />
      </WithSteps>
    );
  }
  if (state.kind === "ready" || state.kind === "countdown" || state.kind === "recording") {
    return (
      <WithSteps step={2}>
        <RecordStage
          state={state}
          stream={recorder.stream}
          prompter={prompter}
          follow={follow}
          holding={hold}
          elapsedMs={recorder.elapsedMs}
          limitMs={recorder.limitMs}
          onRecord={recorder.begin}
          onStop={recorder.stop}
          devices={recorder.devices}
          deviceNote={recorder.deviceNote}
          switching={recorder.switching}
          cameraId={recorder.cameraId}
          micId={recorder.micId}
          onCamera={recorder.chooseCamera}
          onMic={recorder.chooseMic}
          onFlip={recorder.flip}
          onBack={() => {
            recorder.stream?.getTracks().forEach((track) => track.stop());
            recorder.dispatch({ type: "leave" });
          }}
        />
      </WithSteps>
    );
  }
  // A photo or video from the phone's own camera goes through the same upload.
  if (upload.busy)
    return (
      <WithSteps step={3}>
        <UploadProgress state={upload.state} onCancel={upload.cancel} />
      </WithSteps>
    );
  const allowance = usage?.enforced
    ? usageDisplay(usage.allowanceSeconds, usage.usedSeconds)
    : null;
  return (
    <WithSteps step={1}>
      <RecordSetup
        uploadNote={
          upload.state.kind === "rejected"
            ? upload.state.message
            : upload.state.kind === "cancelled"
              ? "The upload was cancelled."
              : null
        }
        usedUp={usage && isUsedUp(usage) ? usedUpMessage(usage) : null}
        script={script}
        onScript={editScript}
        failure={state.kind === "failed" ? state.failure : null}
        busy={state.kind === "requesting"}
        touch={isTouchDevice()}
        wpm={prompter.settings.wpm}
        leftMinutes={allowance ? allowance.leftMinutes : null}
        follow={{
          enabled: prompter.settings.follow,
          onChange: prompter.setFollow,
          disclosureSeen: prompter.settings.followDisclosed,
          onDisclosureSeen: prompter.markFollowDisclosed,
        }}
        onStart={() => {
          preloadSteps();
          void recorder.request();
        }}
        onNativeFile={(file) => void upload.start(file)}
      />
    </WithSteps>
  );
}

/** The three step marker above whichever step is showing. */
function WithSteps({ step, children }: { readonly step: 1 | 2 | 3; readonly children: ReactNode }) {
  return (
    <>
      <RecordSteps current={step} />
      {children}
    </>
  );
}
