import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getDb } from "@/server/request";
import { recentForCreator } from "@/server/takes/recent";
import { SidebarBody } from "./sidebar-body";
import { SkipLink } from "./skip-link";
import { TopBar, type ShellCurrent } from "./top-bar";
import type { ShellUser } from "./user-menu";

export type { ShellCurrent };

/**
 * The signed in app frame (design.md §4b, spec 0009 AC-4). At 1024 px and wider: a 264 px
 * sticky sidebar (logo, "Upload a take", Takes, recent takes, user menu) beside the main
 * column. Below that the sidebar becomes a sheet opened from the top bar. The sticky glass top
 * bar carries the breadcrumb and the status chip. Skip link first, then the sidebar, banner
 * and main landmarks. Server component: it reads the five newest takes itself; the nav links,
 * recent list, user menu and sheet are the client leaves. Mounts the toast region once.
 */
export async function AppShell({
  user,
  current,
  children,
}: {
  readonly user: ShellUser;
  /** The take the page shows, for the breadcrumb and status chip; absent on the library. */
  readonly current?: ShellCurrent;
  readonly children: React.ReactNode;
}) {
  const recent = await recentForCreator(await getDb(), user.id);
  return (
    <TooltipProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
        <SkipLink />
        <aside
          aria-label="Sidebar"
          className="sticky top-0 hidden h-dvh border-r border-hairline bg-background px-4 py-5 lg:block"
        >
          <SidebarBody user={user} recent={recent} />
        </aside>
        <div className="min-w-0">
          <TopBar user={user} recent={recent} current={current} />
          <main
            id="content"
            tabIndex={-1}
            className="mx-auto w-full max-w-content px-[clamp(16px,2.4vw,32px)] py-6 outline-hidden lg:py-8"
          >
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
