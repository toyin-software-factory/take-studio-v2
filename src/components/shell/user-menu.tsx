"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, FileText, LogOut, ShieldCheck } from "lucide-react";
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
import { LEGAL_LINKS } from "@/lib/legal-links";
import { notify } from "@/components/ui/sonner";
import { initialsOf } from "./initials";

export type ShellUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/**
 * Signs out, goes to the public homepage and refreshes so server components see the signed out state.
 * The Better Auth client is imported when you sign out, so it is not part of every signed in page's first load.
 */
function useSignOut() {
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
        // /library signed out goes to /sign-in, so land on the public page first.
        router.replace("/");
        router.refresh();
      }
    } catch {
      failed();
    }
  };
}

/** The user menu at the bottom of the sidebar (and the phone sheet): who you are, sign out. */
export function UserMenu({ user }: { readonly user: ShellUser }) {
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-hidden hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11">
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
        <DropdownMenuItem onSelect={() => void signOut()}>
          <Icon icon={LogOut} size="badge" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
