"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** What the first time disclosure says (spec 0021 AC-12); the Privacy page says the same. */
export const FOLLOW_DISCLOSURE = {
  title: "Follow my voice sends your audio to Deepgram",
  sent: "While you record, your microphone audio is sent live to Deepgram, our speech to text provider, so the prompter can find your place in your script.",
  notSent:
    "Your video, your name and your email are not sent. We don't store this audio, and we ask Deepgram not to use it to train its models.",
  off: "You can turn it off at any time. The prompter then scrolls on a timer.",
} as const;

/** The first time dialog for Follow my voice: it only turns on after "Turn on". */
export function FollowConsent({
  open,
  onOpenChange,
  onConfirm,
  returnFocusId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  /** The switch that asked, so focus goes back to it (no trigger element holds the dialog). */
  readonly returnFocusId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(returnFocusId)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{FOLLOW_DISCLOSURE.title}</DialogTitle>
          <DialogDescription>{FOLLOW_DISCLOSURE.sent}</DialogDescription>
        </DialogHeader>
        <p>{FOLLOW_DISCLOSURE.notSent}</p>
        <p>{FOLLOW_DISCLOSURE.off}</p>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={onConfirm}>Turn on</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
