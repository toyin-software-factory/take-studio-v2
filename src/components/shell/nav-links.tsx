"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { isActive, isSoon, navItems } from "./nav-items";

/** Main nav links. The active one gets --selected-surface plus a 3 px primary bar (design.md). */
export function NavLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {navItems.map((item) => {
        const row =
          "flex items-center gap-3 h-10 rounded-md px-2.5 text-[15px] font-normal text-text-muted outline-hidden pointer-coarse:min-h-11";
        if (isSoon(item)) {
          return (
            <li key={item.label}>
              <span aria-disabled="true" className={cn(row, "cursor-default")}>
                <Icon icon={item.icon} />
                {item.label}
                <span className="ml-auto rounded-full border border-hairline px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                  Soon
                </span>
              </span>
            </li>
          );
        }
        const active = isActive(item.href, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                row,
                "transition-colors hover:bg-hover-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring",
                active && "bg-hover-surface text-text",
              )}
            >
              <Icon icon={item.icon} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
