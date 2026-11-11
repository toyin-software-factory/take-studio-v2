"use client";

import { useId, useState } from "react";
import { z } from "zod";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type TakeData, apiMessage, takeSchema } from "@/lib/take-api";
import { TAKE_TITLE_MAX } from "@/lib/processing";
import { callApi } from "./browser-io";

const renamedSchema = z.object({ take: takeSchema });

/**
 * Rename a take (AC-9): PATCH /api/takes/{id} { title }. The label stays visible, errors show
 * under the field with an icon and are linked by `aria-describedby` (design.md Inputs).
 * Escape or Cancel closes without saving.
 */
export function RenameForm({
  take,
  onDone,
}: {
  readonly take: TakeData;
  readonly onDone: (renamed: TakeData | null) => void;
}) {
  const [title, setTitle] = useState(take.title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  const save = async () => {
    const next = title.trim();
    if (next === take.title) return onDone(null);
    if (next.length === 0) return setError("Enter a title.");
    setSaving(true);
    setError(null);
    try {
      const reply = await callApi(`/api/takes/${take.id}`, "PATCH", { title: next });
      const parsed = renamedSchema.safeParse(reply.data);
      if (reply.status === 200 && parsed.success) return onDone(parsed.data.take);
      setError(apiMessage(reply.data, "The title wasn't saved. Please try again."));
    } catch {
      setError("The title wasn't saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(null);
      }}
    >
      <Label htmlFor={`${id}-title`}>Title</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={TAKE_TITLE_MAX}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setTitle(event.target.value)}
          className="max-w-md flex-1"
        />
        <Button type="submit" loading={saving}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-center gap-1 text-small text-danger"
        >
          <Icon icon={CircleAlert} size="badge" />
          {error}
        </p>
      ) : null}
    </form>
  );
}
