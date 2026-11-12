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
import {
  type BackgroundItem,
  type BackgroundListData,
  ORIGINAL_BACKGROUND,
} from "@/lib/background-api";
import { BackgroundTile } from "./background-tile";

const GROUP = "background-choice";

function Grid({
  items,
  value,
  onChange,
}: {
  readonly items: readonly BackgroundItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <BackgroundTile
          key={item.id}
          group={GROUP}
          value={item.id}
          name={item.name}
          alt={item.alt}
          thumbUrl={item.thumbUrl}
          checked={value === item.id}
          onSelect={() => onChange(item.id)}
        />
      ))}
    </div>
  );
}

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
}: {
  /** The button that opens the dialog; focus returns to it when the dialog closes. */
  readonly trigger: React.ReactNode;
  readonly list: BackgroundListData;
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  const mine = list.mine.filter((item) => item.status === "ready");
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
          <fieldset className="m-0 flex flex-col gap-6 border-0 p-0">
            <legend className="sr-only">Choose a background</legend>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <BackgroundTile
                group={GROUP}
                value={ORIGINAL_BACKGROUND}
                name="Keep original"
                alt="Keep the background you filmed with"
                thumbUrl={null}
                checked={value === ORIGINAL_BACKGROUND}
                onSelect={() => onChange(ORIGINAL_BACKGROUND)}
              />
            </div>
            {list.builtIn.length > 0 ? (
              <section aria-labelledby="studios-heading" className="flex flex-col gap-3">
                <h3 id="studios-heading" className="text-body font-semibold">
                  Studios
                </h3>
                <Grid items={list.builtIn} value={value} onChange={onChange} />
              </section>
            ) : null}
            {mine.length > 0 ? (
              <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
                <h3 id="mine-heading" className="text-body font-semibold">
                  Your backgrounds
                </h3>
                <Grid items={mine} value={value} onChange={onChange} />
              </section>
            ) : null}
          </fieldset>
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
