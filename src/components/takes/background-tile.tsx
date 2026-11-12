import { Check, ImageOff } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * One choice in the background picker (design.md Background picker): a 16:9 thumbnail, the
 * selected one with a 2 px Brick Red ring, a 2 px white gap and a check on a solid chip. A radio
 * in a group: arrow keys move, Space selects (the browser's own behaviour), and the whole tile
 * is at least 44 px. `thumbUrl` null shows a plain placeholder, as "Keep original" does.
 */
export function BackgroundTile({
  group,
  value,
  name,
  alt,
  thumbUrl,
  checked,
  onSelect,
}: {
  readonly group: string;
  readonly value: string;
  readonly name: string;
  readonly alt: string;
  readonly thumbUrl: string | null;
  readonly checked: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <label className="group relative flex cursor-pointer flex-col gap-1">
      <input
        type="radio"
        name={group}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          "relative block aspect-video overflow-hidden rounded-md bg-muted outline-hidden transition-shadow",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring peer-focus-visible:outline-solid",
          checked && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        )}
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 link, sized by the tile
          <img src={thumbUrl} alt={alt} className="size-full object-cover" loading="lazy" />
        ) : (
          <span role="img" aria-label={alt} className="flex size-full items-center justify-center">
            <Icon icon={ImageOff} size="ui" className="text-text-muted" />
          </span>
        )}
        {checked ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Icon icon={Check} size="badge" />
          </span>
        ) : null}
      </span>
      <span className="min-h-6 text-small leading-tight">{name}</span>
    </label>
  );
}
