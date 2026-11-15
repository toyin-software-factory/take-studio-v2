"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { offersNativeCamera } from "@/lib/recorder-devices";
import { SETUP_MESSAGES, type SetupFailure } from "@/lib/recorder-rules";
import { MEDIA_LIMITS } from "@/lib/take-rules";
import { FollowOption } from "./follow-option";
import { NativeCamera } from "./native-camera";
import { RevealWords } from "./reveal-words";
import { ScriptBox } from "./script-box";
import { SetupAside } from "./setup-aside";
import { SetupNotices } from "./setup-notices";

/** The longest script the page accepts (spec 0021, Configuration). */
export const SCRIPT_MAX = 20_000;

/** First step: an optional script and the button that turns the camera on (AC-5 on failure). */
export function RecordSetup({
  script,
  onScript,
  failure,
  busy,
  usedUp,
  uploadNote,
  touch,
  wpm,
  leftMinutes,
  follow,
  onStart,
  onNativeFile,
}: {
  readonly script: string;
  readonly onScript: (value: string) => void;
  readonly failure: SetupFailure | null;
  readonly busy: boolean;
  /** The used up message when the monthly allowance is gone (AC-6); Record cannot start. */
  readonly usedUp: string | null;
  /** A phone or tablet (a touch screen), where the native camera is a way forward. */
  readonly touch: boolean;
  /** Why the phone camera file was not uploaded; choose it again to retry. */
  readonly uploadNote: string | null;
  /** Words per minute the reading time is worked out at (the prompter speed). */
  readonly wpm: number;
  /** Whole minutes left this month; null when the limit is off or unread. */
  readonly leftMinutes: number | null;
  readonly follow: {
    readonly enabled: boolean;
    readonly onChange: (next: boolean) => void;
    readonly disclosureSeen: boolean;
    readonly onDisclosureSeen: () => void;
  };
  readonly onStart: () => void;
  readonly onNativeFile: (file: File) => void;
}) {
  const message = failure ? SETUP_MESSAGES[failure] : null;
  return (
    <section
      className="rec-setup"
      aria-labelledby="setup-title"
      data-check="s1-setup"
      data-check-section=""
    >
      <div>
        <SetupNotices failure={failure} usedUp={usedUp} uploadNote={uploadNote} />
        <div>
          <p className="rec-eyebrow rec-enter" data-check="s1-setup-text">
            Record a take
          </p>
          <RevealWords
            id="setup-title"
            data-check="s1-setup-heading"
            lines={[{ text: "Write it once.", muted: true }, { text: "Read it to the lens." }]}
          />
        </div>
        <ScriptBox script={script} onScript={onScript} max={SCRIPT_MAX} wpm={wpm} />
        <FollowOption
          enabled={follow.enabled}
          onChange={follow.onChange}
          disclosureSeen={follow.disclosureSeen}
          onDisclosureSeen={follow.onDisclosureSeen}
        />
        <div className="rec-go">
          <button
            type="button"
            className="rec-split"
            data-check="s1-setup-cta-3"
            aria-disabled={busy || usedUp !== null}
            onClick={() => {
              if (!busy && usedUp === null) onStart();
            }}
          >
            <span className="rec-split__label" data-check="s1-setup-cta-4">
              {busy ? "Turning on…" : failure ? "Try again" : "Turn on camera"}
            </span>
            <span className="rec-split__icon" aria-hidden="true">
              <ArrowRight size={18} strokeWidth={1.5} />
            </span>
          </button>
          {offersNativeCamera(failure, touch) ? <NativeCamera onFile={onNativeFile} /> : null}
          {message ? null : (
            <Link href="/library" className="rec-tlink">
              Upload a file instead
            </Link>
          )}
        </div>
        <p className="rec-fine">
          Your browser will ask to use your camera and microphone. The recording stays on this
          device until you choose &ldquo;Use this take&rdquo;.
        </p>
      </div>
      <SetupAside leftMinutes={leftMinutes} maxTakeSeconds={MEDIA_LIMITS.maxDurationMs / 1000} />
    </section>
  );
}
