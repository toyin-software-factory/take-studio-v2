import { type ApiAuthDeps } from "./api-auth";
import type { UploadDeps } from "./uploads";
import { handleCreate as handleUploadCreate, type HttpDeps } from "./uploads/http";
import { handleUsage } from "./usage/http";

/**
 * Spec 0018 step 3: one identity entry point and one guard (AC-5, AC-6, AC-9, AC-10, AC-16),
 * through the real handlers GET /api/usage, GET /api/takes and POST /api/uploads.
 */
export const ORIGIN = "https://take-studio.example";
export const URL_BASE = "https://take-studio.example";
export type Session = { sessionOf: string | null; calls: number };
export const noSession = (): Session => ({ sessionOf: null, calls: 0 });
export const usage = (deps: ApiAuthDeps, headers: Record<string, string> = {}) =>
  handleUsage(new Request(`${URL_BASE}/api/usage`, { headers }), {
    ...deps,
    usageSecret: () => "x".repeat(40),
  });
export const uploadDeps = (deps: ApiAuthDeps): HttpDeps => ({
  ...deps,
  allowedOrigin: ORIGIN,
  // Bad input is refused before any upload dependency is touched.
  uploadDeps: () => ({}) as UploadDeps,
});
export const uploadBad = (deps: ApiAuthDeps, headers: Record<string, string>) =>
  handleUploadCreate(
    new Request(`${URL_BASE}/api/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
    uploadDeps(deps),
  );
export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
