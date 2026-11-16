import { parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { getDb } from "../request";
import type { GuestTakeDeps } from "./take";

/** The real dependencies of `GET /api/guest/take` (spec 0023, G30). */
export function guestTakeDeps(): GuestTakeDeps {
  const r2 = createR2(parseWebEnv());
  return {
    getDb,
    headObject: (key) => r2.headObject(key),
    presignGet: (key, options) => r2.presignGet(key, options),
  };
}
