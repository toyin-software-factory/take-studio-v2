/**
 * What the pages say about the free monthly allowance (spec 0015 value sourcing). The three
 * wordings are fixed templates; only the minutes change, and the hash test uses `{minutes}`.
 */
export type AllowanceState =
  | { readonly kind: "on"; readonly minutes: string }
  | { readonly kind: "off" }
  | { readonly kind: "unavailable" };

export const MINUTES_TOKEN = "{minutes}";

export function AllowanceNote({ state }: Readonly<{ state: AllowanceState }>) {
  if (state.kind === "on") {
    return (
      <p>
        Free accounts get {state.minutes} minutes of processing a month, currently, and this can
        change. The count restarts each month.
      </p>
    );
  }
  if (state.kind === "off") {
    return (
      <p>
        There is no monthly limit for now. We plan to add one, and we will update this page before
        we do.
      </p>
    );
  }
  return (
    <p>
      The current monthly allowance is temporarily unavailable here. Your own usage meter in the app
      shows what you have left.
    </p>
  );
}
