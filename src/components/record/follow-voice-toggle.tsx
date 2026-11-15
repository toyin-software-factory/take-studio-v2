"use client";

import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FollowConsent } from "./follow-consent";
import type { VoiceFollow } from "./use-voice-follow";

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
        <Label htmlFor={id} className="text-small">
          Follow my voice
        </Label>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-small">
        {enabled && follow.status === "connecting" ? "Connecting…" : null}
        {enabled && follow.status === "ready" ? "Voice ready" : null}
        {enabled && follow.status === "following" ? "Following your voice." : null}
        {enabled && follow.status === "fallback" ? follow.note : null}
      </p>
      <FollowConsent
        open={asking}
        onOpenChange={setAsking}
        onConfirm={confirm}
        returnFocusId={id}
      />
    </div>
  );
}
