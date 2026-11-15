"use client";

import { useId, useState } from "react";
import { FollowConsent } from "./follow-consent";

/**
 * "Follow my voice" on the Script step (draft row: name, one line of what it does, a switch).
 * Off by default. The first time it is turned on the Deepgram dialog asks; whether it was seen
 * is kept by the caller (per creator, on this device).
 */
export function FollowOption({
  enabled,
  onChange,
  disclosureSeen,
  onDisclosureSeen,
}: {
  readonly enabled: boolean;
  readonly onChange: (next: boolean) => void;
  readonly disclosureSeen: boolean;
  readonly onDisclosureSeen: () => void;
}) {
  const id = useId();
  const noteId = useId();
  const [asking, setAsking] = useState(false);
  const toggle = () => {
    if (!enabled && !disclosureSeen) setAsking(true);
    else onChange(!enabled);
  };
  const confirm = () => {
    onDisclosureSeen();
    setAsking(false);
    onChange(true);
  };
  return (
    <div className="rec-opt">
      <span>
        <b>Follow my voice</b>
        <small id={noteId}>
          The script moves when you talk and waits when you stop. Your audio goes to Deepgram while
          you record. Off: it scrolls on a timer.
        </small>
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Follow my voice"
        aria-describedby={noteId}
        className="rec-switch"
        data-check="s1-setup-cta-2"
        onClick={toggle}
      >
        <span />
      </button>
      <FollowConsent
        open={asking}
        onOpenChange={setAsking}
        onConfirm={confirm}
        returnFocusId={id}
      />
    </div>
  );
}
