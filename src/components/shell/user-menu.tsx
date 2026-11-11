"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
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
import { notify } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";
import { initialsOf } from "./initials";

export type ShellUser = { readonly name: string; readonly email: string };

/** Signs out, then refreshes so server components see the signed out state. */
function useSignOut() {
  const router = useRouter();
  return async () => {
    const failed = () =>
      notify("error", {
        title: "Couldn't sign you out",
        description: "Check your connection, then try again.",
      });
    try {
      const { error } = await authClient.signOut();
      if (error) failed();
      else router.refresh();
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
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-hidden hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11">
        <Avatar>
          <AvatarFallback>{initialsOf(user.name, user.email)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small font-medium">{user.name}</span>
          <span className="block truncate text-caption text-text-muted">{user.email}</span>
        </span>
        <Icon icon={ChevronsUpDown} size="badge" className="text-text-muted" />
        <span className="sr-only">Account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        // Above the phone menu sheet (dialog layer), which this menu can open from.
        className="z-(--z-toast) w-(--radix-dropdown-menu-trigger-width)"
      >
        <DropdownMenuLabel className="truncate text-text-muted">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <Icon icon={LogOut} size="badge" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
