"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { API_KEYS } from "@/lib/api-rules";
import { KEY_COPY } from "@/lib/api-keys-screen";

/**
 * The create form (spec 0018 AC-12): one name field, 1 to 60 characters, its error linked to
 * the field. Disabled while a new key is still on screen, so it can't be replaced unsaved.
 * A refusal from the server (the 5 key limit, a network failure) is a `role="alert"` line.
 */
export function KeyForm({
  pending,
  locked,
  nameError,
  createError,
  inputRef,
  onSubmit,
}: {
  readonly pending: boolean;
  readonly locked: boolean;
  readonly nameError: string | null;
  readonly createError: string | null;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  return (
    <form
      noValidate
      className="grid max-w-xl gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSubmit(name)) setName("");
        else inputRef.current?.focus();
      }}
    >
      <Field
        id="api-key-name"
        label={KEY_COPY.nameLabel}
        helper={KEY_COPY.nameHelper}
        error={nameError ?? undefined}
      >
        {(props) => (
          <Input
            {...props}
            ref={inputRef}
            name="key-name"
            autoComplete="off"
            maxLength={API_KEYS.nameMaxLength * 2}
            value={name}
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      {createError ? (
        <p role="alert" className="flex items-start gap-2 text-small text-danger">
          <Icon icon={CircleAlert} size="badge" className="mt-0.5" />
          {createError}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={pending} disabled={locked}>
          Make a key
        </Button>
      </div>
    </form>
  );
}
