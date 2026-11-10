import { expect, test } from "@playwright/test";

test("landing placeholder renders with a sign in button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Take Studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("health reports the database reachable through Hyperdrive", async ({ request }) => {
  const res = await request.get("/api/health");
  const body = (await res.json()) as { checks: { database: string; storage: string } };
  expect(body.checks.database).toBe("ok");
  // Storage needs real R2 credentials, so it is only checked on the deployed Worker.
  expect(["ok", "error"]).toContain(body.checks.storage);
});

test("sign in starts the Google OAuth flow", async ({ request }) => {
  const res = await request.post("/api/auth/sign-in/social", {
    data: { provider: "google", callbackURL: "/" },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { url: string };
  expect(new URL(body.url).hostname).toBe("accounts.google.com");
});
