import { Code2, Film, ImageIcon, Settings, type LucideIcon } from "lucide-react";

type Base = { readonly label: string; readonly icon: LucideIcon };
/** A page that exists: a link. */
export type LinkItem = Base & { readonly href: string };
/** A page that is drawn but not built yet: shown with a "Soon" badge, not a link. */
export type SoonItem = Base & { readonly soon: true };
export type NavItem = LinkItem | SoonItem;

export const isSoon = (item: NavItem): item is SoonItem => "soon" in item;

/** Main navigation, as drawn in the /record design (spec 0001 docs/design/record-v2.html). */
export const navItems: readonly NavItem[] = [
  { href: "/library", label: "Takes", icon: Film },
  { label: "Backgrounds", icon: ImageIcon, soon: true },
  { href: "/docs/api", label: "API and agents", icon: Code2 },
  { label: "Settings", icon: Settings, soon: true },
];

/** True when `pathname` is the item's page or one of its sub pages. */
export function isActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
