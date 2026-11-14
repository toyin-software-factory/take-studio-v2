"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { KEY_COPY } from "@/lib/api-keys-screen";

/**
 * The confirm dialog for revoking a key (spec 0018 AC-12), the same pattern as the delete take
 * dialog: Radix traps focus and closes on Escape, a failed revoke keeps it open and moves focus
 * to the `role="alert"` line, and while the request runs it can't be closed. Closed without a
 * revoke, focus returns to that row's button; after a revoke the caller places focus.
 */
export function RevokeKeyDialog({
  target,
  open,
  onOpenChange,
  onConfirm,
  returnFocus,
}: {
  /** The key being asked about; it stays set while the dialog closes, so the text doesn't blank. */
  readonly target: { readonly id: string; readonly name: string } | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (id: string) => Promise<boolean>;
  readonly returnFocus: (id: string) => HTMLElement | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const revoked = useRef(false);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  function change(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirm() {
    if (!target || pending) return;
    setPending(true);
    setError(null);
    revoked.current = false;
    const done = await onConfirm(target.id);
    setPending(false);
    if (done) {
      revoked.current = true;
      onOpenChange(false);
    } else setError(KEY_COPY.revokeFailed);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        size="sm"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!revoked.current && target) returnFocus(target.id)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Revoke this key?</DialogTitle>
          <DialogDescription>
            <span className="block font-medium break-words text-foreground">{target?.name}</span>
            <span className="mt-1 block">
              Anything using it stops working right away. This can&apos;t be undone.
            </span>
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            className="flex items-start gap-2 rounded-sm text-small text-danger outline-hidden"
          >
            <Icon icon={CircleAlert} size="badge" className="mt-0.5" />
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => change(false)}>
            Keep it
          </Button>
          <Button variant="destructive" loading={pending} onClick={() => void confirm()}>
            Revoke key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
