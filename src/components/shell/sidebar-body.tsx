"use client";

import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { RecentTake } from "@/server/takes/views";
import { NavLinks } from "./nav-links";
import { RecentTakes } from "./recent-takes";
import { UserMenu, type ShellUser } from "./user-menu";

function Brand({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <Link
      href="/library"
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-md px-3 py-1 text-h4 outline-hidden pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring"
    >
      <Icon icon={Clapperboard} />
      Take Studio
    </Link>
  );
}

/**
 * What the sidebar holds, top to bottom (design.md §4b): logo, the "Upload a take" pill, the
 * nav, recent takes, and the user menu at the bottom. The same content fills the phone sheet,
 * which passes `onNavigate` to close itself when a link is used.
 */
export function SidebarBody({
  user,
  recent,
  onNavigate,
}: {
  readonly user: ShellUser;
  readonly recent: readonly RecentTake[];
  readonly onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <Brand onNavigate={onNavigate} />
      <Button asChild size="lg" className="w-full">
        <Link href="/library" onClick={onNavigate}>
          Upload a take
        </Link>
      </Button>
      <nav aria-label="Main">
        <NavLinks onNavigate={onNavigate} />
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        <RecentTakes takes={recent} onNavigate={onNavigate} />
      </div>
      <UserMenu user={user} />
    </div>
  );
}
