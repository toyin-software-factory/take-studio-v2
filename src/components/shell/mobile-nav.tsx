"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";
import { UserMenu, type ShellUser } from "./user-menu";

/** Phones (below md): the menu button in the top bar opens the nav in a left sheet. */
export function MobileNav({ user }: { readonly user: ShellUser }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Icon icon={Menu} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle>Take Studio</SheetTitle>
          <SheetDescription className="sr-only">Main menu</SheetDescription>
        </SheetHeader>
        <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-contain p-3">
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
        <div className="border-t p-3">
          <UserMenu user={user} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
