"use client";

import { useEffect, useRef } from "react";
import { SwitchCamera } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { shouldWarn } from "@/lib/recorder-rules";
import { formatClock } from "@/lib/take-display";
import type { RecorderState } from "@/lib/recorder-state";
import type { DeviceChoices } from "@/lib/recorder-devices";
import { DevicePickers } from "./device-pickers";
import { LevelMeter } from "./level-meter";
import { PauseButton, PrompterControls } from "./prompter-controls";
import { FollowVoiceToggle } from "./follow-voice-toggle";
import { PrompterText } from "./prompter-text";
import type { Prompter } from "./use-prompter";
import { useLevel } from "./use-level";
import type { VoiceFollow } from "./use-voice-follow";

/**
 * The live preview (mirrored, display only: the file is never mirrored), the script over it,
 * the 3 2 1 countdown, the timer and the Record and Stop buttons. The countdown and the
 * 60 second warning are spoken through one polite status line.
 */
export function RecordStage({
  state,
  stream,
  prompter,
  follow,
  holding,
  elapsedMs,
  limitMs,
  onRecord,
  onStop,
  devices,
  deviceNote,
  switching,
  cameraId,
  micId,
  onCamera,
  onMic,
  onFlip,
}: {
  readonly state: RecorderState;
  readonly stream: MediaStream | null;
  readonly prompter: Prompter;
  readonly follow: VoiceFollow;
  /** The countdown is at 0, waiting for Follow my voice to connect (at most 5 seconds). */
  readonly holding: boolean;
  readonly elapsedMs: number;
  readonly limitMs: number;
  readonly onRecord: () => void;
  readonly onStop: () => void;
  readonly devices: DeviceChoices;
  readonly deviceNote: string | null;
  /** A camera or microphone change is in flight: Record waits for it. */
  readonly switching: boolean;
  readonly cameraId: string | null;
  readonly micId: string | null;
  readonly onCamera: (id: string) => void;
  readonly onMic: (id: string) => void;
  readonly onFlip: (() => void) | null;
}) {
  const level = useLevel(stream);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const recording = state.kind === "recording";
  const countdown = state.kind === "countdown";
  const leftMs = Math.max(0, limitMs - elapsedMs);
  const warn = recording && shouldWarn(elapsedMs, limitMs);
  const status = holding
    ? "Connecting voice…"
    : countdown
      ? `Recording starts in ${state.secondsLeft}`
      : warn
        ? "One minute left"
        : recording
          ? "Recording"
          : "";

  return (
    <div className="rst" data-recording={recording} data-check="s2-stage">
      <div className="rst-col">
        <div className="rst-cam" data-check="s2-stage-media">
          {/* Muted: no echo of your own voice. Mirrored for the creator only. */}
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
            className="size-full -scale-x-100 object-cover"
          />
          <div
            data-check="s2-stage-text"
            className="pointer-events-none absolute inset-x-3 top-3 bottom-14 z-[1] flex flex-col gap-2"
          >
            <PrompterText
              prompter={prompter}
              followWordIndex={follow.status === "following" ? follow.wordIndex : null}
            />
          </div>
          {countdown && state.secondsLeft > 0 ? (
            <div aria-hidden="true" className="rst-count">
              {state.secondsLeft}
            </div>
          ) : null}
          {holding ? (
            <div aria-hidden="true" className="rst-count" style={{ fontSize: "var(--fs-h3)" }}>
              Connecting voice…
            </div>
          ) : null}
          <div className="rst-top">
            <span className="rst-pill">
              <i aria-hidden="true" />
              <span data-testid={recording ? "record-timer" : "record-limit"}>
                {recording
                  ? `${formatClock(elapsedMs)} / ${formatClock(limitMs)}`
                  : `Up to ${formatClock(limitMs)}`}
              </span>
            </span>
          </div>
        </div>
        <p role="status" className="sr-only">
          {status}
        </p>
        {warn ? (
          <p className="rst-warn-text">
            {formatClock(leftMs)} left. The recording stops by itself at the limit.
          </p>
        ) : null}
        {deviceNote ? (
          <p role="alert" className="rst-warn-text">
            {deviceNote}
          </p>
        ) : null}
        <div className="rst-dock">
          <div className="rst-dock-l">
            {onFlip ? (
              <button
                type="button"
                className="rst-btn"
                data-round
                data-check="s2-stage-cta-3"
                aria-label="Flip camera"
                disabled={state.kind !== "ready"}
                onClick={onFlip}
              >
                <Icon icon={SwitchCamera} />
              </button>
            ) : null}
            {prompter.total > 0 ? <PauseButton prompter={prompter} /> : null}
          </div>
          <button
            type="button"
            className="rst-rec"
            data-check="s2-stage-cta"
            data-recording={recording}
            disabled={!recording && (countdown || switching || limitMs <= 0)}
            onClick={recording ? onStop : onRecord}
          >
            <span className="rst-ring" aria-hidden="true">
              <span className="rst-core" />
            </span>
            {recording ? "Stop" : countdown ? "Starting…" : "Record"}
          </button>
          <div className="rst-dock-l" aria-hidden="true" />
        </div>
      </div>
      <aside className="rst-panel" aria-label="Recording settings">
        <h3 data-check="s2-stage-heading">Script and camera</h3>
        {prompter.total > 0 ? <PrompterControls prompter={prompter} /> : null}
        <div className="rst-row">
          <LevelMeter level={level} />
        </div>
        <DevicePickers
          choices={devices}
          cameraId={cameraId}
          micId={micId}
          locked={state.kind !== "ready"}
          onCamera={onCamera}
          onMic={onMic}
          onFlip={null}
        />
        {prompter.total > 0 ? (
          <FollowVoiceToggle
            enabled={prompter.settings.follow}
            onChange={prompter.setFollow}
            disclosureSeen={prompter.settings.followDisclosed}
            onDisclosureSeen={prompter.markFollowDisclosed}
            follow={follow}
          />
        ) : null}
      </aside>
    </div>
  );
}
