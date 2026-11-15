import { builtInTracker } from "@/db/testing/test-db";
import { type BackgroundHttpDeps, handleChangeBackground } from "./http";

export const ORIGIN = "https://take-studio.example";
export const built = builtInTracker();
export const put = (body: unknown, origin: string | null = ORIGIN) =>
  new Request("https://x.test/api/takes/x/background", {
    method: "PUT",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
export async function call(
  d: BackgroundHttpDeps,
  takeId: string,
  body: unknown,
  origin: string | null = ORIGIN,
) {
  const res = await handleChangeBackground(put(body, origin), takeId, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
