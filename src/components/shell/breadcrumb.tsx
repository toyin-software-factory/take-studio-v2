"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/takes/status-badge";
import { useCurrentTake } from "./current-take";

/**
 * The breadcrumb "Takes / take title" and the status chip (design.md §4b), read from the live
 * current take, so a rename or a status change shows at once. Its last item is
 * `aria-current="page"`; on the library it is just "Takes".
 */
export function Breadcrumb() {
  const current = useCurrentTake();
  return (
    <>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-small">
          {current ? (
            <>
              <li className="shrink-0">
                <Link
                  href="/library"
                  className="inline-flex items-center rounded-xs underline decoration-transparent underline-offset-[6px] transition-[text-decoration-color,text-underline-offset] duration-400 ease-ui outline-hidden hover:decoration-current hover:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
    </>
  );
}
