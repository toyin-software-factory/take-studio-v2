import { expect, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { query, seedGuest, setGuestCookie } from "./support/guest";
import { signIn } from "./support/session";

// The /claim page and the claim route (spec 0023 AC-3, AC-4, AC-5, AC-9, AC-12). Guests and takes
// are seeded in the database; a claim that must ask storage whether an upload finished (the
// parked case) cannot run against the CI fake R2, so `src/server/guest/claim.test.ts` owns it; the claim transaction, the page and the route are the real ones.
test.describe.configure({ timeout: 60_000 });

const NONE = "We couldn't find an upload to add. It may already be in your library.";

test("same browser: the cookie moves the video at once (AC-3)", async ({
  page,
  context,
  baseURL,
}) => {
  const { user, cleanup } = await signIn(context, baseURL!);
  const guest = await seedGuest({ email: "someone.else@example.test" });
  try {
    await setGuestCookie(context, baseURL!, guest.token);
    await page.goto(`/claim?c=${guest.claimId}`);
    await expect(page).toHaveURL(new RegExp(`/takes/${guest.takeId}$`));
    const [row] = await query(
      (sql) => sql`select creator_id, guest_origin from take where id = ${guest.takeId}`,
    );
    expect(row?.creator_id).toBe(user.id);
    const gone = await query((sql) => sql`select 1 from "user" where id = ${guest.guestUserId}`);
    expect(gone).toHaveLength(0);
  } finally {
    await cleanup();
    await guest.cleanup().catch(() => undefined);
  }
});

test("other device: the verified email asks first, then adds (AC-4)", async ({
  page,
  context,
  baseURL,
}) => {
  const { user, cleanup } = await signIn(context, baseURL!);
  const guest = await seedGuest({ email: user.email });
  try {
    await page.goto(`/claim?c=${guest.claimId}`);
    await expect(
      page.getByRole("heading", { name: "Add this video to your library?" }),
    ).toBeVisible();
    await expectNoSeriousAxeIssues(page);
    const before = await query(
      (sql) => sql`select creator_id from take where id = ${guest.takeId}`,
    );
    expect(before[0]?.creator_id).toBe(guest.guestUserId);
    await page.getByRole("button", { name: "Add to my library" }).click();
    await expect(page).toHaveURL(new RegExp(`/takes/${guest.takeId}$`));
    const [row] = await query((sql) => sql`select creator_id from take where id = ${guest.takeId}`);
    expect(row?.creator_id).toBe(user.id);
  } finally {
    await cleanup();
    await guest.cleanup().catch(() => undefined);
  }
});

test("a stranger gets the calm message and nothing moves (AC-5)", async ({
  page,
  context,
  baseURL,
}) => {
  const { cleanup } = await signIn(context, baseURL!);
  const guest = await seedGuest({ email: "owner@example.test" });
  try {
    await page.goto(`/claim?c=${guest.claimId}`);
    await expect(page.getByRole("heading", { name: NONE })).toBeVisible();
    await expectNoSeriousAxeIssues(page);
    const [row] = await query((sql) => sql`select creator_id from take where id = ${guest.takeId}`);
    expect(row?.creator_id).toBe(guest.guestUserId);
  } finally {
    await cleanup();
    await guest.cleanup();
  }
});

test("an unknown claim link says the same thing (AC-5)", async ({ page, context, baseURL }) => {
  const { cleanup } = await signIn(context, baseURL!);
  try {
    await page.goto("/claim?c=00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: NONE })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("signed out, the claim link goes to sign in and keeps the way back (AC-3)", async ({
  page,
}) => {
  await page.goto("/claim?c=00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/sign-in\?return=%2Fclaim%3Fc%3D/);
});

test("a guest cookie reaches no other video and no library (AC-12)", async ({
  page,
  context,
  baseURL,
}) => {
  const guest = await seedGuest({ email: "x@example.test" });
  try {
    await setGuestCookie(context, baseURL!, guest.token);
    await page.goto("/library");
    await expect(page).toHaveURL(/\/sign-in/);
    const res = await page.request.get(`/api/takes/${guest.takeId}`);
    expect([401, 403, 404]).toContain(res.status());
  } finally {
    await guest.cleanup();
  }
});
