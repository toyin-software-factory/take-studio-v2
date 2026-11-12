"use client";

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
import type { BackgroundListData } from "@/lib/background-api";
import { BackgroundGrid } from "./background-grid";
import type { MineActions } from "./background-mine";

const GROUP = "background-choice";

/**
 * The background picker dialog (spec 0008, AC-1, AC-12; a bottom sheet on phones): "Keep
 * original", then the built in studios, then the creator's own ready uploads. One radio group,
 * so the arrow keys move and Space selects; a choice applies at once and Done closes.
 */
export function BackgroundPicker({
  trigger,
  list,
  value,
  onChange,
  mine: mineActions,
}: {
  /** The button that opens the dialog; focus returns to it when the dialog closes. */
  readonly trigger: React.ReactNode;
  readonly list: BackgroundListData;
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Uploading, deleting and the state of the upload (spec 0008, AC-8, AC-10). */
  readonly mine: MineActions;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Background</DialogTitle>
          <DialogDescription>
            Pick the studio your green screen is swapped for. You can change it later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <BackgroundGrid
            group={GROUP}
            list={list}
            value={value}
            onChange={onChange}
            mine={mineActions}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
