import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTakeEmails } from "@/db/data/email-prefs";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { signUnsubscribe } from "@/lib/email-links";
import { turnOffTakeEmails } from "./turn-off";

const SECRET = "test-email-link-secret-0123456789abcdef";
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

describe("turnOffTakeEmails (spec 0006, AC-6)", () => {
  it("turns emails off with the right signature only", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const bad = await turnOffTakeEmails(db, { userId: creator.id, signature: "nope" }, SECRET);
    expect(bad).toBe("invalid");
    const crossed = await turnOffTakeEmails(
      db,
      { userId: creator.id, signature: await signUnsubscribe(other.id, SECRET) },
      SECRET,
    );
    expect(crossed).toBe("invalid");
    expect(await getTakeEmails(db, creator.id)).toBe(true);

    const good = await turnOffTakeEmails(
      db,
      { userId: creator.id, signature: await signUnsubscribe(creator.id, SECRET) },
      SECRET,
    );
    expect(good).toBe("off");
    expect(await getTakeEmails(db, creator.id)).toBe(false);
    expect(await getTakeEmails(db, other.id)).toBe(true);
  });

  it("treats a missing parameter or unknown user as invalid", async () => {
    expect(await turnOffTakeEmails(db, { userId: null, signature: "x" }, SECRET)).toBe("invalid");
    const ghost = "no-such-user";
    const sig = await signUnsubscribe(ghost, SECRET);
    expect(await turnOffTakeEmails(db, { userId: ghost, signature: sig }, SECRET)).toBe("invalid");
  });
});
