"use client";

import { useEffect, useRef } from "react";
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
import { DELETE_WARNING } from "@/lib/take-delete";
import { useDeleteTake } from "./use-delete-take";

/**
 * The confirm dialog for deleting a take (spec 0013 AC-4, AC-5, AC-12), used by the take page
 * and by the library cards. Radix traps focus and closes on Escape. Closed without a delete
 * (Keep it, Escape), focus goes back to `returnFocus()`; after a delete the caller decides
 * where focus lands (`onDeleted`). A failed delete keeps the dialog open and moves focus to the
 * `role="alert"` line, so the trap holds. While the request runs the buttons are disabled and
 * the dialog cannot be closed.
 */
export function DeleteTakeDialog({
  takeId,
  title,
  open,
  onOpenChange,
  onDeleted,
  returnFocus,
}: {
  readonly takeId: string;
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDeleted: () => void;
  readonly returnFocus: () => HTMLElement | null;
}) {
  const del = useDeleteTake(takeId);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const deleted = useRef(false);
  const { error, reset } = del;

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (open) {
      deleted.current = false;
      reset();
    }
  }, [open, reset]);

  const confirm = async () => {
    if (await del.run()) {
      deleted.current = true;
      onOpenChange(false);
      onDeleted();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (del.pending ? undefined : onOpenChange(next))}>
      <DialogContent
        size="sm"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          // After a delete the caller places focus; otherwise return it to the opener.
          event.preventDefault();
          if (!deleted.current) returnFocus()?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete this take?</DialogTitle>
          <DialogDescription>
            <span className="block font-medium break-words text-foreground">{title}</span>
            <span className="mt-1 block">{DELETE_WARNING}</span>
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
          <Button variant="secondary" disabled={del.pending} onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button variant="destructive" loading={del.pending} onClick={() => void confirm()}>
            Delete take
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
