import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTakeEmails } from "@/db/data/email-prefs";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { handleGetPrefs, handleSetPrefs } from "./prefs-http";

const ORIGIN = "https://app.example.com";
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const depsFor = (creatorId: string | null) => ({
  allowedOrigin: ORIGIN,
  getCreator: async () => (creatorId ? { db, creatorId } : null),
});
const patch = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/account/email-prefs`, {
    method: "PATCH",
    headers: origin ? { origin, "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  });

describe("email prefs API (spec 0006, AC-6)", () => {
  it("turns take emails off and back on for the signed in creator only", async () => {
    const me = await createCreator(db);
    const other = await createCreator(db);
    const off = await handleSetPrefs(patch({ takeEmails: false }), depsFor(me.id));
    expect(off.status).toBe(200);
    expect(await getTakeEmails(db, me.id)).toBe(false);
    expect(await getTakeEmails(db, other.id)).toBe(true);
    const read = await handleGetPrefs(new Request(`${ORIGIN}/x`), depsFor(me.id));
    expect(await read.json()).toEqual({ takeEmails: false });
    await handleSetPrefs(patch({ takeEmails: true }), depsFor(me.id));
    expect(await getTakeEmails(db, me.id)).toBe(true);
  });

  it("refuses no session, a foreign origin and a bad body", async () => {
    const me = await createCreator(db);
    expect((await handleSetPrefs(patch({ takeEmails: false }), depsFor(null))).status).toBe(401);
    expect(
      (await handleSetPrefs(patch({ takeEmails: false }, "https://evil.test"), depsFor(me.id)))
        .status,
    ).toBe(403);
    expect((await handleSetPrefs(patch({ takeEmails: "no" }), depsFor(me.id))).status).toBe(422);
    expect(await getTakeEmails(db, me.id)).toBe(true);
  });
});
