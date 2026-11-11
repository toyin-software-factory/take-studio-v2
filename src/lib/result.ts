/**
 * Typed result for expected failures (AGENTS.md "Errors"): data functions return this
 * instead of throwing across a boundary. `error` is a short code the caller maps to a
 * friendly message.
 */
export type Result<T, E extends string> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(data: T): { readonly ok: true; readonly data: T } => ({ ok: true, data });

export const err = <E extends string>(error: E): { readonly ok: false; readonly error: E } => ({
  ok: false,
  error,
});
