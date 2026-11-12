"use client";

import {
  type BackgroundItem,
  type BackgroundListData,
  ORIGINAL_BACKGROUND,
} from "@/lib/background-api";
import { BackgroundMine, type MineActions } from "./background-mine";
import { BackgroundTile } from "./background-tile";

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3";

/**
 * The picker's tiles (spec 0008, AC-4, AC-12), shared by the dialog in the upload area and the
 * section on the take page: "Keep original", the built in studios, anything that must stay
 * visible although the list does not name it (`extras`: the current and the chosen background
 * when the list failed to load), then "Your backgrounds" with the upload tile. One radio group
 * per `group`, so the arrow keys move and Space selects.
 */
export function BackgroundGrid({
  group,
  list,
  extras = [],
  value,
  onChange,
  mine,
  original = { thumbUrl: null },
}: {
  readonly group: string;
  readonly list: BackgroundListData;
  readonly extras?: readonly BackgroundItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly mine: MineActions;
  /** The take's own thumbnail for "Keep original" (the take page); the upload area has none. */
  readonly original?: { readonly thumbUrl: string | null; readonly onThumbError?: () => void };
}) {
  const tiles = (items: readonly BackgroundItem[]) =>
    items.map((item) => (
      <BackgroundTile
        key={item.id}
        group={group}
        value={item.id}
        name={item.name}
        alt={item.alt}
        thumbUrl={item.thumbUrl}
        checked={value === item.id}
        onSelect={() => onChange(item.id)}
      />
    ));
  return (
    <fieldset className="m-0 flex flex-col gap-6 border-0 p-0">
      <legend className="sr-only">Choose a background</legend>
      <div className={GRID}>
        <BackgroundTile
          group={group}
          value={ORIGINAL_BACKGROUND}
          name="Keep original"
          alt="Keep the background you filmed with"
          thumbUrl={original.thumbUrl}
          onThumbError={original.onThumbError}
          checked={value === ORIGINAL_BACKGROUND}
          onSelect={() => onChange(ORIGINAL_BACKGROUND)}
        />
      </div>
      {list.builtIn.length > 0 ? (
        <section aria-labelledby={`${group}-studios`} className="flex flex-col gap-3">
          <h3 id={`${group}-studios`} className="text-body font-semibold">
            Studios
          </h3>
          <div className={GRID}>{tiles(list.builtIn)}</div>
        </section>
      ) : null}
      {extras.length > 0 ? (
        <section aria-labelledby={`${group}-extras`} className="flex flex-col gap-3">
          <h3 id={`${group}-extras`} className="text-body font-semibold">
            Current and chosen
          </h3>
          <div className={GRID}>{tiles(extras)}</div>
        </section>
      ) : null}
      <BackgroundMine
        items={list.mine}
        value={value}
        onChange={onChange}
        group={group}
        actions={mine}
      />
    </fieldset>
  );
}
