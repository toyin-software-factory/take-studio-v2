"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  DELETE_ACCOUNT_FAILED,
  DELETE_ACCOUNT_REASON,
  DELETE_ACCOUNT_WARNING,
  isStaleSession,
} from "./delete-account";

/**
 * The confirm dialog for deleting the account (spec 0015 step 7, AC-13). Better Auth's
 * `deleteUser` runs the same `beforeDelete` path as spec 0002 (every take, file and background
 * goes first), refuses a sign in older than 10 minutes, and clears the session. Done: the
 * creator lands on the public page, signed out. A stale session is signed out and sent to
 * `/sign-in` with the reason, and the sign in returns here with the dialog open. A failed
 * delete keeps the dialog open and moves focus to the `role="alert"` line.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnFocus: () => HTMLElement | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);
  function change(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    done.current = false;
    try {
      const { authClient } = await import("@/lib/auth-client");
      const { error: failure } = await authClient.deleteUser();
      if (!failure) {
        done.current = true;
        onOpenChange(false);
        router.replace("/");
        router.refresh();
        return;
      }
      if (isStaleSession(failure)) {
        done.current = true;
        await authClient.signOut();
        onOpenChange(false);
        router.replace(`/sign-in?reason=${DELETE_ACCOUNT_REASON}`);
        router.refresh();
        return;
      }
      setError(DELETE_ACCOUNT_FAILED);
    } catch {
      setError(DELETE_ACCOUNT_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        size="sm"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!done.current) returnFocus()?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>{DELETE_ACCOUNT_WARNING}</DialogDescription>
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
            Keep my account
          </Button>
          <Button variant="destructive" loading={pending} onClick={() => void confirm()}>
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
