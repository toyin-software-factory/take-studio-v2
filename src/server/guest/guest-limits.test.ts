import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admitGuestTake } from "@/db/data/guest-admit";
import { releaseGuestMinutes, reserveGuestMinutes } from "@/db/data/guest-budget";
import { transitionTake } from "@/db/data/takes";
import { appSetting, guestBudgetDay, guestIpDay, take } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { GUEST_COOKIE } from "@/lib/guest-rules";
import { fakeR2 } from "../uploads/uploads-test-helpers";
import { body, guestDeps, guestRequest, MiB, randomIp } from "./guest-test-helpers";
import { handleGuestCreate } from "./http";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_limits" });
  // The database is reused between runs: start with default settings and an empty budget.
  await testDb.db.delete(appSetting);
  await testDb.db.delete(guestBudgetDay);
});
// A test that throws before clearing its setting must not leave it for the next one.
afterEach(async () => {
  await testDb.db.delete(appSetting);
});
afterAll(() => testDb?.close());

const upload = () => ({ db: testDb.db, r2: fakeR2().r2, dispatchProbe: async () => undefined });
const freshIp = randomIp;
const cookieOf = (res: Response) =>
  /ts_guest=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
const drop = (ip: string, cookie?: string, payload: unknown = body) =>
  handleGuestCreate(
    guestRequest(payload, {
      "cf-connecting-ip": ip,
      ...(cookie ? { cookie: `${GUEST_COOKIE}=${cookie}` } : {}),
    }),
    guestDeps(upload()),
  );
const setSetting = (key: string, value: unknown) =>
  testDb.db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value } });
const clearSettings = () => testDb.db.delete(appSetting);

/** A guest drop moved to `uploaded` with a probed length, as the probe would leave it. */
async function probedTake(durationMs: number): Promise<string> {
  const res = await drop(freshIp());
  const { takeId } = (await res.json()) as { takeId: string };
  await testDb.db.update(take).set({ status: "uploaded", durationMs }).where(eq(take.id, takeId));
  return takeId;
}
const budgetOf = async (day: string) =>
  (await testDb.db.select().from(guestBudgetDay).where(eq(guestBudgetDay.day, day)))[0]
    ?.reservedMinutes ?? 0;
const takeRow = async (id: string) =>
  (await testDb.db.select().from(take).where(eq(take.id, id)))[0];

describe("guest drop limits (spec 0023, AC-6)", () => {
  it("refuses a file over 500 MB", async () => {
    const res = await drop(freshIp(), undefined, { ...body, sizeBytes: 501 * MiB });
    expect(res.status).toBe(422);
  });

  it("allows one active upload per browser: a second tab gets 429 guest_busy", async () => {
    const ip = freshIp();
    const first = await drop(ip);
    const token = cookieOf(first);
    const second = await drop(ip, token);
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toBe("guest_busy");
  });

  it("allows 3 drops per address per UTC day, then 429; another address is unaffected", async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i += 1) expect((await drop(ip)).status).toBe(201);
    const fourth = await drop(ip);
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toBe("guest_address_limit");
    expect((await drop(freshIp())).status).toBe(201);
    const rows = await testDb.db.select().from(guestIpDay);
    expect(rows.every((r) => r.drops <= 3)).toBe(true);
  });

  it("a refused busy drop is not counted against the address", async () => {
    const ip = freshIp();
    const first = await drop(ip);
    const token = cookieOf(first);
    const { takeId } = (await first.json()) as { takeId: string };
    expect((await drop(ip, token)).status).toBe(429); // busy, rolled back
    await testDb.db.update(take).set({ status: "uploaded" }).where(eq(take.id, takeId));
    expect((await drop(ip, token)).status).toBe(201); // second counted drop
    const [second] = await testDb.db.select().from(take).orderBy(desc(take.createdAt)).limit(1);
    await testDb.db
      .update(take)
      .set({ status: "uploaded" })
      .where(eq(take.id, second?.id ?? ""));
    expect((await drop(ip, token)).status).toBe(201); // third counted drop: busy was not counted
  });

  it("the kill switch refuses new drops with 503 guest_paused", async () => {
    await setSetting("guest_upload_enabled", false);
    const res = await drop(freshIp());
    await clearSettings();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("guest_paused");
  });

  it("a spent budget refuses the drop early with 403 guest_budget_spent", async () => {
    await setSetting("guest_daily_minutes", 0);
    const res = await drop(freshIp());
    await clearSettings();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("guest_budget_spent");
  });
});

describe("probe length check and the daily budget (AC-6)", () => {
  const today = () => new Date().toISOString().slice(0, 10);

  it("a 4 minute video fails guest_too_long, nothing reserved, original queued for deletion", async () => {
    const id = await probedTake(4 * 60_000);
    const before = await budgetOf(today());
    expect(await admitGuestTake(testDb.db, id)).toBe("guest_too_long");
    const row = await takeRow(id);
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("guest_too_long");
    expect(row?.guestReservedMinutes).toBeNull();
    expect(await budgetOf(today())).toBe(before);
  });

  it("reserves the probed minutes rounded up, on the take and on the day", async () => {
    const id = await probedTake(61_000);
    const before = await budgetOf(today());
    expect(await admitGuestTake(testDb.db, id)).toBe("admitted");
    const row = await takeRow(id);
    expect(row?.guestReservedMinutes).toBe(2);
    expect(row?.guestReservedDay).toBe(today());
    expect(await budgetOf(today())).toBe(before + 2);
    // Running again does not reserve twice.
    expect(await admitGuestTake(testDb.db, id)).toBe("admitted");
    expect(await budgetOf(today())).toBe(before + 2);
  });

  it("a spent budget fails guest_budget_spent and two concurrent reservations cannot both pass", async () => {
    const a = await probedTake(120_000);
    const b = await probedTake(120_000);
    const used = await budgetOf(today());
    await setSetting("guest_daily_minutes", used + 2);
    const results = await Promise.all([admitGuestTake(testDb.db, a), admitGuestTake(testDb.db, b)]);
    await clearSettings();
    expect([...results].sort()).toEqual(["admitted", "guest_budget_spent"]);
    expect(await budgetOf(today())).toBe(used + 2);
  });

  it("a signed in take is never reserved", async () => {
    const id = await probedTake(120_000);
    await testDb.db.update(take).set({ guestOrigin: false }).where(eq(take.id, id));
    expect(await admitGuestTake(testDb.db, id)).toBe("admitted");
    expect((await takeRow(id))?.guestReservedMinutes).toBeNull();
  });

  it("a take that failed before the reservation lock gets no minutes", async () => {
    const id = await probedTake(60_000);
    await testDb.db.update(take).set({ status: "failed" }).where(eq(take.id, id));
    const before = await budgetOf(today());
    const res = await reserveGuestMinutes(testDb.db, { takeId: id, durationMs: 60_000 });
    expect(res.ok).toBe(false);
    expect(await budgetOf(today())).toBe(before);
    expect((await takeRow(id))?.guestReservedMinutes).toBeNull();
  });

  it("a failed take releases once; a second release is a no-op", async () => {
    const id = await probedTake(60_000);
    const before = await budgetOf(today());
    await admitGuestTake(testDb.db, id);
    expect(await budgetOf(today())).toBe(before + 1);
    await transitionTake(testDb.db, id, "uploaded", "failed", { failureCode: "internal_error" });
    expect(await budgetOf(today())).toBe(before);
    expect(await releaseGuestMinutes(testDb.db, id)).toBe(false);
    expect(await budgetOf(today())).toBe(before);
  });

  it("a release after UTC midnight subtracts from the day that was reserved", async () => {
    const id = await probedTake(180_000);
    const yesterday = new Date(Date.now() - 86_400_000);
    const yDay = yesterday.toISOString().slice(0, 10);
    expect(
      await reserveGuestMinutes(testDb.db, { takeId: id, durationMs: 180_000, now: yesterday }),
    ).toEqual({ ok: true });
    const yBefore = await budgetOf(yDay);
    const tBefore = await budgetOf(today());
    expect(await releaseGuestMinutes(testDb.db, id)).toBe(true);
    expect(await budgetOf(yDay)).toBe(yBefore - 3);
    expect(await budgetOf(today())).toBe(tBefore);
  });

  it("a finished take keeps its reservation", async () => {
    const id = await probedTake(60_000);
    await admitGuestTake(testDb.db, id);
    await testDb.db.update(take).set({ status: "ready" }).where(eq(take.id, id));
    expect((await takeRow(id))?.guestReservedMinutes).toBe(1);
  });
});
