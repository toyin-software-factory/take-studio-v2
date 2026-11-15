import { type ChangesHttpDeps, handleChanges } from "./http";

export const ORIGIN = "https://take-studio.example";
export const A = { startMs: 1000, endMs: 2000 };
export const B = { startMs: 5000, endMs: 6000 };
export async function post(
  d: ChangesHttpDeps,
  takeId: string,
  body: unknown,
  origin: string | null = ORIGIN,
) {
  const res = await handleChanges(
    new Request("https://x.test/api/takes/x/changes", {
      method: "POST",
      headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    takeId,
    d,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
