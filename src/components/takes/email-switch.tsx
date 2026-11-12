"use client";

import { useId, useState } from "react";
import { z } from "zod";
import { Switch } from "@/components/ui/switch";
import { apiMessage } from "@/lib/take-api";
import { callApi } from "./browser-io";

const prefsSchema = z.object({ takeEmails: z.boolean() });

/**
 * "Email me when takes are ready" (spec 0006, AC-6): PATCH /api/account/email-prefs. Turns the
 * take emails back on after the "Turn off these emails" link. The switch shows the saved value;
 * a failed save puts it back and says so.
 */
export function EmailSwitch({
  initial,
  onSaved,
}: {
  readonly initial: boolean;
  /** Called with the saved value after a successful save, so a parent can keep it. */
  readonly onSaved?: (value: boolean) => void;
}) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const change = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const reply = await callApi("/api/account/email-prefs", "PATCH", { takeEmails: next });
      const parsed = prefsSchema.safeParse(reply.data);
      if (reply.status === 200 && parsed.success) {
        setOn(parsed.data.takeEmails);
        onSaved?.(parsed.data.takeEmails);
        return;
      }
      setError(apiMessage(reply.data, "The setting wasn't saved. Please try again."));
    } catch {
      setError("The setting wasn't saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 text-small">
      <div className="flex items-center gap-3">
        <Switch
          id={`${id}-switch`}
          size="sm"
          checked={on}
          disabled={saving}
          onCheckedChange={(next) => void change(next)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <label htmlFor={`${id}-switch`}>Email me when takes are ready</label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
