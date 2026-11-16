"use client";

import type { UploadIo } from "@/lib/upload-client";
import { browserUploadIo, callApi } from "@/components/takes/browser-io";

/**
 * The upload client's I/O for a visitor with no account (spec 0023, AC-1): the create call goes
 * to the guest route with the bot check token; parts and complete use the same routes as a
 * signed in upload, authorised by the guest cookie. The create runs inside a cross tab lock
 * until the cookie is set, so two tabs cannot each make a guest. `refusal` returns the error
 * code of a refused create, which the upload client turns into text only.
 */
export type GuestIo = { readonly io: UploadIo; readonly refusal: () => string | null };

const LOCK = "ts-guest-drop";

async function locked<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return run();
  return await locks.request(LOCK, run);
}

export function guestUploadIo(token: string): GuestIo {
  let refusal: string | null = null;
  const io: UploadIo = {
    ...browserUploadIo,
    api: async (path, method, body) => {
      if (path !== "/api/uploads" || method !== "POST") return callApi(path, method, body);
      const reply = await locked(() =>
        callApi("/api/guest/uploads", "POST", { ...(body as object), turnstileToken: token }),
      );
      const data = reply.data as { error?: unknown } | null;
      refusal = reply.status === 201 || typeof data?.error !== "string" ? null : data.error;
      return reply;
    },
  };
  return { io, refusal: () => refusal };
}
