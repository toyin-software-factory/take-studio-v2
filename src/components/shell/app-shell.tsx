import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { SkipLink } from "./skip-link";
import { UserMenu, type ShellUser } from "./user-menu";

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-md px-2 py-1 text-body font-medium outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
    >
      <Icon icon={Clapperboard} className="text-primary" />
      Take Studio
    </Link>
  );
}

/**
 * The signed in app frame (design.md, Shape, spacing and layout). From md up: a 240 px left
 * sidebar with the nav and the user menu at the bottom. Below md: a top bar whose menu opens
 * the nav in a left sheet. Skip link first, then header, nav and main landmarks; content is
 * capped at 1200 px with 16 px (phone) or 24 px (desktop) gutters. Server component; only
 * the nav links, user menu and sheet are client leaves. Mounts the toast region once.
 */
export function AppShell({
  user,
  children,
}: {
  readonly user: ShellUser;
  readonly children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <div className="min-h-dvh md:grid md:grid-cols-[var(--sidebar-width)_1fr]">
        <SkipLink />
        <header className="sticky top-0 z-(--z-sticky) flex h-14 items-center gap-2 border-b bg-card px-2 md:h-dvh md:flex-col md:items-stretch md:gap-6 md:border-r md:border-b-0 md:px-3 md:py-4">
          <div className="md:hidden">
            <MobileNav user={user} />
          </div>
          <Brand />
          <nav aria-label="Main" className="hidden md:block md:flex-1">
            <NavLinks />
          </nav>
          <div className="hidden md:block">
            <UserMenu user={user} />
          </div>
        </header>
        <main
          id="content"
          tabIndex={-1}
          className="mx-auto w-full max-w-content px-4 py-6 outline-hidden md:px-6 md:py-8"
        >
          {children}
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
