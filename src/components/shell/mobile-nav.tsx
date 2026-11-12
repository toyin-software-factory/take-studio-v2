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
import type { RecentTake } from "@/server/takes/views";
import { SidebarBody } from "./sidebar-body";
import type { ShellUser } from "./user-menu";

/**
 * Below 1024 px: the menu button in the top bar opens the sidebar's content in a left sheet
 * (a dialog: focus is trapped inside, Esc closes it and focus returns to the button).
 */
export function MobileNav({
  user,
  recent,
}: {
  readonly user: ShellUser;
  readonly recent: readonly RecentTake[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Icon icon={Menu} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(88vw,20rem)] gap-0 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Take Studio</SheetTitle>
          <SheetDescription>Main menu</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 px-4 py-5">
          <SidebarBody user={user} recent={recent} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
