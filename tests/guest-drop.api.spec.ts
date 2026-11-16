import { expect, test } from "@playwright/test";
import { setting } from "./support/session";
import { setGuestSettings, TURNSTILE_TEST_TOKEN } from "./support/guest";

// The guest drop route against the built Worker (spec 0023 AC-1, AC-6, AC-7, AC-8, AC-13). It needs
// the Turnstile test keys the Worker was built with; the bot check passes with Cloudflare's test
// secret. Storage is the CI fake, so a drop that would start a real multipart upload cannot run
// here: the success path, the address limit and the one active upload rule are in
// `src/server/guest/*.test.ts` against a real database, and the card in `home-drop.spec.ts`.
const HAS_KEYS = Boolean(setting("TURNSTILE_SECRET_KEY") ?? process.env.TURNSTILE_SITE_KEY);
test.skip(!HAS_KEYS, "needs the Turnstile test keys");
// Two tests change the shared app_setting rows; serial keeps each restore ahead of the next test.
test.describe.configure({ mode: "serial" });

const MiB = 1024 * 1024;
const body = (extra: Record<string, unknown> = {}) => ({
  fileName: "Drop.mov",
  sizeBytes: 40 * MiB,
  container: "mov",
  turnstileToken: TURNSTILE_TEST_TOKEN,
  ...extra,
});
const fresh = () => `2001:db8:${Math.floor(Math.random() * 65535).toString(16)}::1`;

test("a video over 500 MB is refused before anything starts (AC-6)", async ({
  request,
  baseURL,
}) => {
  const res = await request.post("/api/guest/uploads", {
    data: body({ sizeBytes: 501 * MiB }),
    headers: { origin: baseURL!, "cf-connecting-ip": fresh() },
  });
  expect(res.status()).toBe(422);
  expect(((await res.json()) as { error: string }).error).toBe("too_large");
});

test("a foreign origin is refused (AC-13)", async ({ request }) => {
  const res = await request.post("/api/guest/uploads", {
    data: body(),
    headers: { origin: "https://evil.example", "cf-connecting-ip": fresh() },
  });
  expect(res.status()).toBe(403);
});

test("the kill switch pauses the drop box (AC-7)", async ({ request, baseURL }) => {
  const restore = await setGuestSettings({ enabled: false });
  try {
    const res = await request.post("/api/guest/uploads", {
      data: body(),
      headers: { origin: baseURL!, "cf-connecting-ip": fresh() },
    });
    expect(res.status()).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("guest_paused");
  } finally {
    await restore();
  }
});

test("a spent daily budget refuses the next drop (AC-8)", async ({ request, baseURL }) => {
  const restore = await setGuestSettings({ enabled: true, dailyMinutes: 0 });
  try {
    const res = await request.post("/api/guest/uploads", {
      data: body(),
      headers: { origin: baseURL!, "cf-connecting-ip": fresh() },
    });
    expect(((await res.json()) as { error: string }).error).toBe("guest_budget_spent");
  } finally {
    await restore();
  }
});
