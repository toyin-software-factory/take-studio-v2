/**
 * A read that starts early and is awaited later (launch speed review). A bare promise that is
 * awaited only in a child component has no rejection handler until that child renders, so a
 * failure that lands first is an unhandled rejection. `startRead` settles the promise into a
 * value at once; `awaitRead` rethrows in the child, so the route's `error.tsx` behaves as if
 * the page had awaited the read itself.
 */
export type SettledRead<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export function startRead<T>(read: Promise<T>): Promise<SettledRead<T>> {
  return read.then(
    (value): SettledRead<T> => ({ ok: true, value }),
    (error: unknown): SettledRead<T> => ({ ok: false, error }),
  );
}

export async function awaitRead<T>(started: Promise<SettledRead<T>>): Promise<T> {
  const settled = await started;
  if (!settled.ok) throw settled.error;
  return settled.value;
}
