import type { RecentTake } from "@/server/takes/views";
import { Breadcrumb } from "./breadcrumb";
import { MobileNav } from "./mobile-nav";
import type { ShellUser } from "./user-menu";

/**
 * The sticky glass top bar (design.md §4b): at least 72 px, the menu button below 1024 px, and
 * the breadcrumb with the take's status chip (a client leaf that follows the live take).
 */
export function TopBar({
  user,
  recent,
}: {
  readonly user: ShellUser;
  readonly recent: readonly RecentTake[];
}) {
  return (
    <header
      data-check="header"
      className="sticky top-0 z-(--z-nav) flex min-h-[72px] items-center gap-2 border-b py-3 lg:gap-4 border-hairline bg-background/92 px-[clamp(16px,2.4vw,32px)] [backdrop-filter:var(--blur-nav)]"
    >
      <div className="lg:hidden">
        <MobileNav user={user} recent={recent} />
      </div>
      <Breadcrumb />
    </header>
  );
}
