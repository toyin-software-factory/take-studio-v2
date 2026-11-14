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
import { CONNECTED_COPY } from "@/lib/oauth-screen";

/**
 * The confirm dialog for disconnecting an app (spec 0019 AC-14), the same pattern as the revoke
 * key dialog: focus is trapped, Escape closes, a failure keeps it open with a `role="alert"`
 * line, and a cancel returns focus to that row's button. After a disconnect the caller places focus.
 */
export function DisconnectAppDialog({
  target,
  open,
  onOpenChange,
  onConfirm,
  returnFocus,
}: {
  readonly target: { readonly id: string; readonly name: string } | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (id: string) => Promise<boolean>;
  readonly returnFocus: (id: string) => HTMLElement | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (open) done.current = false;
  }, [open]);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  function change(next: boolean) {
    if (pending) return;
    if (!next) setError(false);
    onOpenChange(next);
  }

  async function confirm() {
    if (!target || pending) return;
    setPending(true);
    setError(false);
    const ok = await onConfirm(target.id);
    setPending(false);
    if (ok) {
      done.current = true;
      onOpenChange(false);
    } else setError(true);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        size="sm"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!done.current && target) returnFocus(target.id)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Disconnect this app?</DialogTitle>
          <DialogDescription>
            <span className="block font-medium break-words text-foreground">{target?.name}</span>
            <span className="mt-1 block">
              It stops working right away. You can allow it again later.
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
            {CONNECTED_COPY.disconnectFailed}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => change(false)}>
            Keep it connected
          </Button>
          <Button variant="destructive" loading={pending} onClick={() => void confirm()}>
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
