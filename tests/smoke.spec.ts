import { expect, test } from "@playwright/test";

test("the signed out homepage renders with a sign in link in the top bar", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Film one take. Get it back ready to post." }),
  ).toBeVisible();
  // The page has more than one sign in link (top bar, closing section, footer): the bar's one.
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("health reports the database reachable through Hyperdrive", async ({ request }) => {
  const res = await request.get("/api/health");
  const body = (await res.json()) as { checks: { database: string; storage: string } };
  expect(body.checks.database).toBe("ok");
  // Storage needs real R2 credentials, so it is only checked on the deployed Worker.
  expect(["ok", "error"]).toContain(body.checks.storage);
  expect(res.status()).toBe(body.checks.storage === "ok" ? 200 : 503);
});

test("sign in starts the Google OAuth flow", async ({ request }) => {
  const res = await request.post("/api/auth/sign-in/social", {
    data: { provider: "google", callbackURL: "/library" },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { url: string };
  expect(new URL(body.url).hostname).toBe("accounts.google.com");
});
