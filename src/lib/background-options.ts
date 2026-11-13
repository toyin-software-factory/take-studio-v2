import { ORIGINAL_BACKGROUND } from "./background-api";

/** One entry of the take page's background select. */
export type BackgroundOption = { readonly id: string; readonly name: string };

/**
 * The options of the take page's select (spec 0008): the backgrounds the list returned (the
 * built ins and the creator's ready uploads), plus the one the video is on now and the one
 * currently selected, so a controlled select always has an option that matches its value even
 * when the list could not be loaded. "Keep original" is added by the caller and never listed.
 */
export function selectOptions(
  listed: readonly BackgroundOption[],
  current: { readonly id: string | null; readonly name: string } | null,
  choice: string,
  /** Backgrounds we can name even when the list failed (the AI's suggestion). */
  known: readonly BackgroundOption[] = [],
): BackgroundOption[] {
  const options = [...listed];
  const has = (id: string) => options.some((o) => o.id === id);
  if (current?.id && !has(current.id)) options.push({ id: current.id, name: current.name });
  if (choice !== ORIGINAL_BACKGROUND && !has(choice)) {
    // A choice we cannot name (the list failed, and it is not what the video is on).
    options.push(known.find((k) => k.id === choice) ?? { id: choice, name: "Your earlier choice" });
  }
  return options;
}
