import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/takes/status-badge";
import type { RecentTake } from "@/server/takes/views";
import { MobileNav } from "./mobile-nav";
import type { ShellUser } from "./user-menu";

/** The take the page is showing, for the breadcrumb and the status chip. */
export type ShellCurrent = { readonly title: string; readonly status: string };

/**
 * The sticky glass top bar (design.md §4b): at least 72 px, the menu button below 1024 px, the
 * breadcrumb "Takes / take title" and the take's status chip on the right. The breadcrumb is a
 * `nav` (not the `Main` one) and its last item is `aria-current="page"`.
 */
export function TopBar({
  user,
  recent,
  current,
}: {
  readonly user: ShellUser;
  readonly recent: readonly RecentTake[];
  readonly current?: ShellCurrent;
}) {
  return (
    <header className="sticky top-0 z-(--z-nav) flex min-h-[72px] items-center gap-3 border-b border-hairline bg-nav-glass-light px-[clamp(16px,2.4vw,32px)] [backdrop-filter:var(--blur-nav)]">
      <div className="lg:hidden">
        <MobileNav user={user} recent={recent} />
      </div>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-small">
          {current ? (
            <>
              <li className="shrink-0">
                <Link
                  href="/"
                  className="rounded-xs underline decoration-transparent underline-offset-[6px] transition-[text-decoration-color,text-underline-offset] duration-400 ease-ui outline-hidden hover:decoration-current hover:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring"
                >
                  Takes
                </Link>
              </li>
              <li aria-hidden="true" className="shrink-0 text-muted-foreground">
                <Icon icon={ChevronRight} size="badge" />
              </li>
              <li aria-current="page" className="min-w-0 truncate font-medium">
                {current.title}
              </li>
            </>
          ) : (
            <li aria-current="page" className="font-medium">
              Takes
            </li>
          )}
        </ol>
      </nav>
      {current ? <StatusBadge status={current.status} /> : null}
    </header>
  );
}
