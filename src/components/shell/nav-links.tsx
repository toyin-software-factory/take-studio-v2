"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { isActive, navItems } from "./nav-items";

/** Main nav links. The active one gets --selected-surface plus a 3 px primary bar (design.md). */
export function NavLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {navItems.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-r-md border-l-3 border-transparent px-3 py-2 text-small font-medium text-text transition-colors outline-hidden hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11",
                active && "border-primary bg-selected-surface",
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
