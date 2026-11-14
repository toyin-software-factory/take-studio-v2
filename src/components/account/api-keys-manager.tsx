"use client";

import { useRef, useState } from "react";
import type { ApiKeyView } from "@/lib/api-keys-screen";
import { KeyForm } from "./key-form";
import { KeyList } from "./key-list";
import { NewKeyPanel } from "./new-key-panel";
import { RevokeKeyDialog } from "./revoke-key-dialog";
import { useApiKeys } from "./use-api-keys";

/**
 * The "API keys" screen body (spec 0018 AC-12): create, the show once panel, the list and the
 * revoke confirm. Focus: after a create it moves to the panel's heading; after "I have saved
 * it" to the name field; after a revoke to the list heading; a cancelled revoke returns to its
 * row's button.
 */
export function ApiKeysManager({ initial }: { readonly initial: readonly ApiKeyView[] }) {
  const state = useApiKeys(initial);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const justMade = state.rawKey ? state.keys[0] : undefined;

  return (
    <div className="grid gap-10">
      <KeyForm
        pending={state.pending}
        locked={state.rawKey !== null}
        nameError={state.nameError}
        createError={state.createError}
        inputRef={nameInput}
        onSubmit={state.create}
      />
      {state.rawKey && justMade ? (
        <NewKeyPanel
          name={justMade.name}
          rawKey={state.rawKey}
          onDone={() => {
            state.dismiss();
            // After the panel unmounts: the field is enabled again on the next frame.
            requestAnimationFrame(() => nameInput.current?.focus());
          }}
        />
      ) : null}
      <KeyList
        keys={state.keys}
        headingRef={listHeading}
        onRevoke={(key) => {
          setRevoking(key);
          setConfirmOpen(true);
        }}
      />
      <RevokeKeyDialog
        target={revoking}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={async (id) => {
          const done = await state.revoke(id);
          if (done) requestAnimationFrame(() => listHeading.current?.focus());
          return done;
        }}
        returnFocus={(id) => document.getElementById(`revoke-${id}`)}
      />
    </div>
  );
}
