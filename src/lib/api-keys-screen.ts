import { z } from "zod";
import { API_KEYS, normalizeKeyName } from "./api-rules";

/**
 * Words and shapes for the "API keys" screen (spec 0018 AC-12). Pure: the screen's components
 * and the tests share these. The raw key is never stored here or anywhere but component state.
 */

export const API_KEYS_PATH = "/account/api-keys";

/** A key as the screen shows it (dates as ISO strings so they cross the server/client edge). */
export type ApiKeyView = {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
};

/** The 201 body of POST /api/keys: the only place the raw `key` ever appears. */
export const createdKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  key: z.string().min(1),
  createdAt: z.string(),
});

const failureSchema = z.object({ error: z.string(), message: z.string() });

export const KEY_COPY = {
  nameLabel: "Key name",
  nameHelper: `1 to ${API_KEYS.nameMaxLength} characters, so you can tell your keys apart.`,
  nameError: `Enter a name between 1 and ${API_KEYS.nameMaxLength} characters.`,
  limit: `You already have ${API_KEYS.maxPerCreator} keys. Revoke one to make another.`,
  createFailed: "We couldn't make the key. Check your connection, then try again.",
  revokeFailed: "We couldn't revoke the key. Check your connection, then try again.",
  copied: "Copied",
  copyDenied: "Couldn't copy. The key is selected: press Ctrl+C or Cmd+C to copy it.",
  neverUsed: "Never used",
  empty: "You have no API keys yet. Make one to use Take Studio from your own code.",
  shownOnce: "Copy this key now. You won't see it again.",
  leaveWarning: "You haven't saved your new key. It can't be shown again.",
} as const;

/** The line to show for a refused create: the server's own words for 409 and 422, else fixed. */
export function createFailureMessage(status: number | null, data: unknown): string {
  if (status === 409) return KEY_COPY.limit;
  if (status === 422) return KEY_COPY.nameError;
  const parsed = failureSchema.safeParse(data);
  return status !== null && status >= 400 && status < 500 && parsed.success
    ? parsed.data.message
    : KEY_COPY.createFailed;
}

/** Whether a revoke is done: 204, or 404 (already gone, e.g. a retry or another tab). */
export const revokeDone = (status: number | null): boolean => status === 204 || status === 404;

/** Client side name check, the same rule as the server: trimmed, 1 to 60 characters. */
export function checkKeyName(name: string): { ok: true; name: string } | { ok: false } {
  const normalized = normalizeKeyName(name);
  return normalized === null ? { ok: false } : { ok: true, name: normalized };
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** "Nov 14, 2026" in UTC, so the server render and the browser agree. */
export function keyDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function lastUsedText(iso: string | null): string {
  return iso === null ? KEY_COPY.neverUsed : keyDate(iso);
}

/** Newest first, as GET /api/keys sorts them. */
export function withNewKey(
  keys: readonly ApiKeyView[],
  created: ApiKeyView,
): readonly ApiKeyView[] {
  return [created, ...keys.filter((key) => key.id !== created.id)];
}
