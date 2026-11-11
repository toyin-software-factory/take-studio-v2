import { expect, test } from "@playwright/test";

// Without SENTRY_DSN (local and CI builds) Sentry is off: nothing is sent (spec 0005, AC-8).
test("without a DSN the app sends nothing to Sentry, even on a browser error", async ({ page }) => {
  const sentryRequests: string[] = [];
  page.on("request", (request) => {
    if (/sentry\.io|ingest\.sentry/.test(request.url())) sentryRequests.push(request.url());
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  // An unhandled error in the browser: with a DSN this would be reported (AC-2).
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e: deliberate browser error");
    }, 0);
  });
  await expect.poll(() => pageErrors.length).toBe(1);
  await page.waitForTimeout(500);
  expect(sentryRequests).toEqual([]);
});

test("the Sentry check route is not found without the right token", async ({ request }) => {
  const cases: Record<string, string>[] = [
    {},
    { "x-sentry-check": "wrong" },
    { "x-sentry-check": "" },
  ];
  for (const headers of cases) {
    const res = await request.get("/api/sentry-check", { headers });
    expect(res.status()).toBe(404);
    expect(await res.text()).toBe("Not found");
  }
});
