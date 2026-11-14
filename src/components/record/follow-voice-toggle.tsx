"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { VoiceFollow } from "./use-voice-follow";

/** What the first time disclosure says (spec 0021 AC-12); the Privacy page says the same. */
export const FOLLOW_DISCLOSURE = {
  title: "Follow my voice sends your audio to Deepgram",
  sent: "While you record, your microphone audio is sent live to Deepgram, our speech to text provider, so the prompter can find your place in your script.",
  notSent:
    "Your video, your name and your email are not sent. We don't store this audio, and we ask Deepgram not to use it to train its models.",
  off: "You can turn it off at any time. The prompter then scrolls on a timer.",
} as const;

/**
 * "Follow my voice" (spec 0021 step 2, AC-12, AC-9): off by default. The first time it is turned
 * on, a dialog says what is sent and to whom, and it only turns on after "Turn on". Whether the
 * disclosure was seen is kept by the caller (per creator, on this device). A visible, polite
 * status line says when it is following or has fallen back to the timer.
 */
export function FollowVoiceToggle({
  enabled,
  onChange,
  disclosureSeen,
  onDisclosureSeen,
  follow,
}: {
  readonly enabled: boolean;
  readonly onChange: (next: boolean) => void;
  readonly disclosureSeen: boolean;
  readonly onDisclosureSeen: () => void;
  readonly follow: VoiceFollow;
}) {
  const id = useId();
  const [asking, setAsking] = useState(false);

  const toggle = (next: boolean) => {
    if (next && !disclosureSeen) setAsking(true);
    else onChange(next);
  };
  const confirm = () => {
    onDisclosureSeen();
    setAsking(false);
    onChange(true);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Switch id={id} checked={enabled} onCheckedChange={toggle} />
        <Label htmlFor={id} className="text-small text-on-dark">
          Follow my voice
        </Label>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-small text-on-dark">
        {enabled && follow.status === "connecting" ? "Connecting to follow your voice…" : null}
        {enabled && follow.status === "following" ? "Following your voice." : null}
        {enabled && follow.status === "fallback" ? follow.note : null}
      </p>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{FOLLOW_DISCLOSURE.title}</DialogTitle>
            <DialogDescription>{FOLLOW_DISCLOSURE.sent}</DialogDescription>
          </DialogHeader>
          <p>{FOLLOW_DISCLOSURE.notSent}</p>
          <p>{FOLLOW_DISCLOSURE.off}</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Not now
            </Button>
            <Button onClick={confirm}>Turn on</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
