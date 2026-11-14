"use client";

import { useCallback, useRef, useState } from "react";
import {
  KEY_COPY,
  type ApiKeyView,
  checkKeyName,
  createFailureMessage,
  createdKeySchema,
  revokeDone,
  withNewKey,
} from "@/lib/api-keys-screen";

const TIMEOUT_MS = 30_000;

/** One JSON call to our own key routes. Status is null on a network failure or timeout. */
async function call(path: string, method: "POST" | "DELETE", body?: unknown) {
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: unknown = await response.json().catch(() => null);
    return { status: response.status, data };
  } catch {
    return { status: null, data: null };
  }
}

export type ApiKeysState = {
  readonly keys: readonly ApiKeyView[];
  /** The raw key of the key just made: component state only, cleared by `dismiss`. */
  readonly rawKey: string | null;
  readonly pending: boolean;
  readonly nameError: string | null;
  readonly createError: string | null;
  readonly create: (name: string) => Promise<boolean>;
  readonly dismiss: () => void;
  readonly revoke: (id: string) => Promise<boolean>;
  readonly clearErrors: () => void;
};

/**
 * Create and revoke for the key screen (spec 0018 AC-12). The raw key lives in this state and
 * nowhere else (never a URL, storage, a log or an event); `dismiss` drops it. While a raw key is
 * shown, `create` refuses, so a second key can never replace one that was not saved.
 */
export function useApiKeys(initial: readonly ApiKeyView[]): ApiKeysState {
  const [keys, setKeys] = useState(initial);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const busy = useRef(false);

  const create = useCallback(
    async (name: string) => {
      if (busy.current || rawKey !== null) return false;
      const checked = checkKeyName(name);
      setCreateError(null);
      if (!checked.ok) {
        setNameError(KEY_COPY.nameError);
        return false;
      }
      setNameError(null);
      busy.current = true;
      setPending(true);
      try {
        const reply = await call("/api/keys", "POST", { name: checked.name });
        const parsed = reply.status === 201 ? createdKeySchema.safeParse(reply.data) : null;
        if (!parsed?.success) {
          setCreateError(createFailureMessage(reply.status, reply.data));
          return false;
        }
        const { key, ...view } = parsed.data;
        setRawKey(key);
        setKeys((current) => withNewKey(current, { ...view, lastUsedAt: null }));
        return true;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [rawKey],
  );

  const revoke = useCallback(async (id: string) => {
    const { status } = await call(`/api/keys/${encodeURIComponent(id)}`, "DELETE");
    if (!revokeDone(status)) return false;
    setKeys((current) => current.filter((key) => key.id !== id));
    return true;
  }, []);

  const dismiss = useCallback(() => setRawKey(null), []);
  const clearErrors = useCallback(() => {
    setNameError(null);
    setCreateError(null);
  }, []);

  return { keys, rawKey, pending, nameError, createError, create, dismiss, revoke, clearErrors };
}
