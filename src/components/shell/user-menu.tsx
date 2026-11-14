"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, FileText, KeyRound, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { API_KEYS_PATH } from "@/lib/api-keys-screen";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { clearDraft, deviceStore } from "@/lib/prompter-storage";
import { notify } from "@/components/ui/sonner";
import { DELETE_ACCOUNT_PARAM } from "./delete-account";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { initialsOf } from "./initials";

export type ShellUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/**
 * Signs out, goes to the public homepage and refreshes so server components see the signed out state.
 * The script draft saved in this browser goes too, so the next person on a shared device cannot read it
 * (spec 0021). The Better Auth client is imported when you sign out, so it is not part of every signed in page's first load.
 */
function useSignOut(creatorId: string) {
  const router = useRouter();
  return async () => {
    const failed = () =>
      notify("error", {
        title: "Couldn't sign you out",
        description: "Check your connection, then try again.",
      });
    try {
      const { authClient } = await import("@/lib/auth-client");
      const { error } = await authClient.signOut();
      if (error) failed();
      else {
        clearDraft(deviceStore(), creatorId);
        // /library signed out goes to /sign-in, so land on the public page first.
        router.replace("/");
        router.refresh();
      }
    } catch {
      failed();
    }
  };
}

/**
 * Where focus returns after the dialog closes. At phone width the sidebar's menu button is
 * `display: none`, so fall back to the top bar's "Open menu" button, which is visible.
 */
function visibleFocusTarget(button: HTMLElement | null): HTMLElement | null {
  if (button && button.getClientRects().length > 0) return button;
  return document.querySelector<HTMLElement>('button[aria-label="Open menu"]');
}

/** The user menu at the bottom of the sidebar (and the phone sheet): who you are, sign out. */
export function UserMenu({ user }: { readonly user: ShellUser }) {
  const signOut = useSignOut(user.id);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A fresh sign in after a stale session returns with ?delete-account=1: reopen the dialog.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(DELETE_ACCOUNT_PARAM)) return;
    url.searchParams.delete(DELETE_ACCOUNT_PARAM);
    router.replace(`${url.pathname}${url.search}`);
    // Not synchronous: the dialog opens right after this effect, outside the render.
    queueMicrotask(() => setDeleting(true));
  }, [router]);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-hidden hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11"
        >
          <Avatar>
            <AvatarFallback>{initialsOf(user.name, user.email)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-small font-medium">{user.name}</span>
            <span className="block truncate text-caption text-muted-foreground">{user.email}</span>
          </span>
          <Icon icon={ChevronsUpDown} size="badge" className="text-muted-foreground" />
          <span className="sr-only">Account menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          // Above the phone menu sheet (dialog layer), which this menu can open from.
          className="z-(--z-toast) w-(--radix-dropdown-menu-trigger-width)"
        >
          <DropdownMenuLabel className="truncate text-muted-foreground">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {[LEGAL_LINKS.privacy, LEGAL_LINKS.terms].map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href}>
                <Icon
                  icon={link.href === LEGAL_LINKS.privacy.href ? ShieldCheck : FileText}
                  size="badge"
                />
                {link.label}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={API_KEYS_PATH}>
              <Icon icon={KeyRound} size="badge" />
              API keys
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <Icon icon={LogOut} size="badge" />
            Sign out
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Icon icon={Trash2} size="badge" />
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteAccountDialog
        open={deleting}
        onOpenChange={setDeleting}
        returnFocus={() => visibleFocusTarget(trigger.current)}
      />
    </>
  );
}
