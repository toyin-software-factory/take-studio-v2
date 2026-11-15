import { builtInTracker } from "@/db/testing/test-db";
import { type PreviewHttpDeps, handlePostPreview } from "./preview-http";

export const ORIGIN = "https://take-studio.example";
export const built = builtInTracker();
export const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request("https://x.test/api/takes/x/background/preview", {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
export async function ask(
  d: PreviewHttpDeps,
  takeId: string,
  body: unknown,
  origin: string | null = ORIGIN,
) {
  const res = await handlePostPreview(post(body, origin), takeId, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
