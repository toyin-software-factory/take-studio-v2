import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guestClaim, take, user } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { GUEST_COOKIE } from "@/lib/guest-rules";
import { fakeR2 } from "../uploads/uploads-test-helpers";
import { body, guestDeps, guestRequest, MiB, TEST_SECRET_FAIL } from "./guest-test-helpers";
import { handleGuestCreate } from "./http";
import { turnstileEnvSchema } from "@/lib/env";
import { verifyTurnstile } from "./turnstile";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_upload" });
});
afterAll(() => testDb?.close());

const upload = () => ({ db: testDb.db, r2: fakeR2().r2, dispatchProbe: async () => undefined });
const cookieOf = (res: Response) =>
  /ts_guest=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

describe("POST /api/guest/uploads (spec 0023, AC-1, AC-9)", () => {
  it("makes a guest, a claim and a guest origin take, and sets the cookie", async () => {
    const res = await handleGuestCreate(guestRequest(), guestDeps(upload()));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { takeId: string; partCount: number };
    expect(out.partCount).toBeGreaterThan(0);
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toContain(`${GUEST_COOKIE}=`);
    for (const part of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/", "Max-Age=86400"]) {
      expect(header).toContain(part);
    }
    const [t] = await testDb.db.select().from(take).where(eq(take.id, out.takeId));
    expect(t?.guestOrigin).toBe(true);
    const [u] = await testDb.db
      .select()
      .from(user)
      .where(eq(user.id, t?.creatorId ?? ""));
    expect(u).toMatchObject({ guest: true, takeEmails: false, emailVerified: false });
    expect(u?.email.endsWith("@guest.invalid")).toBe(true);
    const [claim] = await testDb.db
      .select()
      .from(guestClaim)
      .where(eq(guestClaim.guestUserId, u?.id ?? ""));
    expect(claim?.tokenHash).toHaveLength(64);
    expect(claim?.tokenHash).not.toBe(cookieOf(res));
  });

  it("reuses the guest for a second drop with the same cookie", async () => {
    const first = await handleGuestCreate(guestRequest(), guestDeps(upload()));
    const token = cookieOf(first);
    // One active upload per browser: the first must be finished before the second drop.
    const firstId = ((await first.clone().json()) as { takeId: string }).takeId;
    await testDb.db.update(take).set({ status: "uploaded" }).where(eq(take.id, firstId));
    const second = await handleGuestCreate(
      guestRequest(body, { cookie: `${GUEST_COOKIE}=${token}` }),
      guestDeps(upload()),
    );
    expect(second.status).toBe(201);
    expect(cookieOf(second)).toBe(token);
    const ids = [(await first.json()).takeId, (await second.json()).takeId] as string[];
    const rows = await Promise.all(
      ids.map((id) => testDb.db.select().from(take).where(eq(take.id, id))),
    );
    expect(rows[0]?.[0]?.creatorId).toBe(rows[1]?.[0]?.creatorId);
  });

  it("treats a cookie it does not know as no cookie and makes a new guest", async () => {
    const res = await handleGuestCreate(
      guestRequest(body, { cookie: `${GUEST_COOKIE}=nope` }),
      guestDeps(upload()),
    );
    expect(res.status).toBe(201);
    expect(cookieOf(res)).not.toBe("nope");
  });

  it("refuses a wrong Origin, a bad body, an unknown key and a file over 500 MB", async () => {
    const deps = guestDeps(upload());
    const wrongOrigin = guestRequest(body, { origin: "https://evil.example" });
    expect((await handleGuestCreate(wrongOrigin, deps)).status).toBe(403);
    for (const bad of [
      { ...body, container: "avi" },
      { ...body, script: "hi" },
      { ...body, backgroundId: "original" },
      { ...body, turnstileToken: undefined },
    ]) {
      expect((await handleGuestCreate(guestRequest(bad), deps)).status).toBe(422);
    }
    const big = await handleGuestCreate(guestRequest({ ...body, sizeBytes: 501 * MiB }), deps);
    expect(big.status).toBe(422);
    expect(((await big.json()) as { error: string }).error).toBe("too_large");
  });

  it("fails closed: no Turnstile secret, no address header, or a failed or unreachable check", async () => {
    const countTakes = async () => (await testDb.db.select({ id: take.id }).from(take)).length;
    const before = await countTakes();
    expect((await handleGuestCreate(guestRequest(), guestDeps(upload(), { env: {} }))).status).toBe(
      503,
    );
    const noIp = new Request(guestRequest().url, {
      method: "POST",
      headers: { origin: guestRequest().headers.get("origin") ?? "" },
      body: JSON.stringify(body),
    });
    expect((await handleGuestCreate(noIp, guestDeps(upload()))).status).toBe(503);
    const failed = await handleGuestCreate(
      guestRequest(),
      guestDeps(upload(), { verify: async () => ({ ok: false, error: "failed" }) }),
    );
    expect(failed.status).toBe(403);
    expect(((await failed.json()) as { error: string }).error).toBe("bot_check_failed");
    const down = await handleGuestCreate(
      guestRequest(),
      guestDeps(upload(), { verify: async () => ({ ok: false, error: "unavailable" }) }),
    );
    expect(down.status).toBe(503);
    expect(await countTakes()).toBe(before);
  });
});

describe("verifyTurnstile", () => {
  const input = { secret: TEST_SECRET_FAIL, token: "t", ip: "203.0.113.7" };
  it("maps success, failure, a bad status and a bad body", async () => {
    const reply = (status: number, json: unknown) => async () =>
      new Response(JSON.stringify(json), { status });
    expect(await verifyTurnstile(input, reply(200, { success: true }))).toEqual({
      ok: true,
      data: true,
    });
    expect(
      await verifyTurnstile(input, reply(200, { success: false, "error-codes": ["x"] })),
    ).toEqual({
      ok: false,
      error: "failed",
    });
    for (const code of ["internal-error", "invalid-input-secret"]) {
      expect(
        await verifyTurnstile(input, reply(200, { success: false, "error-codes": [code] })),
      ).toEqual({ ok: false, error: "unavailable" });
    }
    expect(
      turnstileEnvSchema.safeParse({ TURNSTILE_SECRET_KEY: "s", TURNSTILE_SITE_KEY: "" }).success,
    ).toBe(true);
    expect(await verifyTurnstile(input, reply(500, {}))).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await verifyTurnstile(input, reply(200, { nope: 1 }))).toEqual({
      ok: false,
      error: "unavailable",
    });
    const boom = async () => {
      throw new Error("down");
    };
    expect(await verifyTurnstile(input, boom)).toEqual({ ok: false, error: "unavailable" });
  });
});
