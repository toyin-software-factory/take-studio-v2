"use client";

import { useEffect, useRef } from "react";
import { Download, Link2, Menu, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { notify } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DemoBlock, DemoGroup } from "./demo-block";

const sizes = ["sm", "md", "lg"] as const;

/** Dialog sizes with a scrolling body; on phones each opens as a bottom sheet. */
function SizedDialog({ size }: { readonly size: (typeof sizes)[number] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">Open {size} dialog</Button>
      </DialogTrigger>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>Rename take</DialogTitle>
          <DialogDescription>
            A {size} dialog. The body scrolls; the actions stay put.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-small">
          {Array.from({ length: size === "lg" ? 12 : 3 }, (_, i) => (
            <p key={i}>Paragraph {i + 1} of the dialog body, here to show scrolling.</p>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>Save</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog, destructive confirm, sheet, dropdown menu, tooltip and toasts.
 *
 * `data-overlays-ready="true"` is set once this section's effects have run. React runs a child's
 * effects before its parent's, so by then Radix's menu has registered its document keydown
 * listener; until then a key press can open a menu without Radix knowing it was the keyboard,
 * and focus stays on the menu instead of its first item. The browser tests wait for the
 * attribute before pressing keys (tests/design-components.spec.ts).
 */
export function OverlayDemos() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.setAttribute("data-overlays-ready", "true");
  }, []);
  return (
    <div ref={root} className="contents">
      <TooltipProvider>
        <DemoGroup title="Dialog, sheet, menu, tooltip and toast">
          <DemoBlock title="Dialog sizes">
            {sizes.map((size) => (
              <SizedDialog key={size} size={size} />
            ))}
          </DemoBlock>
          <DemoBlock title="Destructive confirm">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">Delete take</Button>
              </DialogTrigger>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Delete this take?</DialogTitle>
                  <DialogDescription>
                    Deletes the video, cuts and transcript of &lsquo;My take&rsquo;. You can&rsquo;t
                    undo this.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">Delete take</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </DemoBlock>
          <DemoBlock title="Sheet, menu and tooltip">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Icon icon={Menu} />
                  Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>Take Studio</SheetTitle>
                  <SheetDescription>The phone menu opens in a left sheet.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="More actions">
                  <Icon icon={MoreHorizontal} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>
                  <Icon icon={Pencil} size="badge" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Icon icon={Download} size="badge" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Icon icon={Link2} size="badge" /> Share link (soon)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Icon icon={Trash2} size="badge" /> Delete take
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Copy link">
                  <Icon icon={Link2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
          </DemoBlock>
          <DemoBlock title="Toasts (success and info close after 5 s, paused on hover or focus; errors stay)">
            <Button
              variant="secondary"
              onClick={() => notify("default", { title: "Take uploaded" })}
            >
              Default toast
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify("success", {
                  title: "Cut removed",
                  description: "Pause, 1.2 seconds.",
                  action: {
                    label: "Undo",
                    onClick: () => notify("info", { title: "Cut restored" }),
                  },
                })
              }
            >
              Success toast
            </Button>
            <Button
              variant="secondary"
              onClick={() => notify("info", { title: "Rendering started" })}
            >
              Info toast
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify("error", {
                  title: "Upload failed",
                  description: "Check your connection, then try again.",
                })
              }
            >
              Error toast
            </Button>
          </DemoBlock>
        </DemoGroup>
      </TooltipProvider>
    </div>
  );
}
