"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { offersNativeCamera } from "@/lib/recorder-devices";
import { SETUP_MESSAGES, type SetupFailure } from "@/lib/recorder-rules";
import { NativeCamera } from "./native-camera";

/** The longest script the page accepts (spec 0021, Configuration). */
export const SCRIPT_MAX = 20_000;

/** First step: an optional script and the button that turns the camera on (AC-5 on failure). */
export function RecordSetup({
  script,
  onScript,
  failure,
  busy,
  usedUp,
  touch,
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
  readonly onStart: () => void;
  readonly onNativeFile: (file: File) => void;
}) {
  const message = failure ? SETUP_MESSAGES[failure] : null;
  return (
    <div className="flex flex-col gap-4">
      {usedUp ? (
        <Alert variant="danger" title="No recording time left">
          {usedUp}{" "}
          <Link href="/library" className="underline">
            Back to your library
          </Link>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="danger" title={message.title}>
          {message.body}{" "}
          <Link href="/library" className="underline">
            Upload a file instead
          </Link>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="record-script">Script (optional)</Label>
        <Textarea
          id="record-script"
          value={script}
          maxLength={SCRIPT_MAX}
          placeholder="Paste or type what you want to say. It scrolls while you record."
          onChange={(event) => onScript(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" loading={busy} disabled={usedUp !== null} onClick={onStart}>
          <Icon icon={Camera} /> {failure ? "Try again" : "Turn on camera"}
        </Button>
        {offersNativeCamera(failure, touch) ? <NativeCamera onFile={onNativeFile} /> : null}
        {message ? null : (
          <Link href="/library" className="text-small underline">
            Upload a file instead
          </Link>
        )}
      </div>
      <p className="text-small text-muted-foreground">
        Your browser will ask to use your camera and microphone. The recording stays on this device
        until you choose &ldquo;Use this take&rdquo;.
      </p>
    </div>
  );
}
