import { Film, type LucideIcon } from "lucide-react";

export type NavItem = { readonly href: string; readonly label: string; readonly icon: LucideIcon };

/** Main navigation. Items join as their pages ship (take library, settings ...). */
export const navItems: readonly NavItem[] = [{ href: "/library", label: "Takes", icon: Film }];

/** True when `pathname` is the item's page or one of its sub pages. */
export function isActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
