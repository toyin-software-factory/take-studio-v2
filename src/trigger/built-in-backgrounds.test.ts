import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_BACKGROUNDS, builtInKeys, studiosToInstall } from "@/lib/built-in-backgrounds";
import { ensureBuiltInBackgrounds } from "./built-in-backgrounds";
import { background } from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";

/** Spec 0008 AC-7: the built in studios are installed idempotently, and a test studio never reaches production. */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  // Its own database: it deletes and re creates the built in rows, which other test files read.
  testDb = await openTestDb({ database: "take_studio_test_seed" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

function fakeR2() {
  const puts: string[] = [];
  return { puts, r2: { putObject: async (key: string) => void puts.push(key) } };
}

const ids = BUILT_IN_BACKGROUNDS.map((b) => b.id);
const rows = () => db.select().from(background).where(inArray(background.id, ids));

describe("which studios are installed where", () => {
  it("installs every studio locally, and only the real ones anywhere else", () => {
    expect(studiosToInstall(true)).toEqual(BUILT_IN_BACKGROUNDS);
    const remote = studiosToInstall(false);
    expect(remote.every((b) => b.testOnly !== true)).toBe(true);
    // The placeholder is a test studio: production gets backgrounds only with the real six.
    const placeholder = BUILT_IN_BACKGROUNDS.find((b) => b.slug === "studio-placeholder");
    expect(placeholder?.testOnly).toBe(true);
    expect(remote.some((b) => b.slug === "studio-placeholder")).toBe(false);
  });

  it("gives every studio its own fixed ID and files", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILT_IN_BACKGROUNDS.map((b) => b.slug)).size).toBe(ids.length);
    for (const b of BUILT_IN_BACKGROUNDS) {
      expect(builtInKeys(b.slug)).toEqual({
        imageKey: `backgrounds/builtin/${b.slug}.jpg`,
        thumbKey: `backgrounds/builtin/${b.slug}.webp`,
      });
    }
  });
});

describe("ensureBuiltInBackgrounds", () => {
  it("installs ready built in rows with their files, and does the same again without duplicating", async () => {
    await db.delete(background).where(inArray(background.id, ids));
    const first = fakeR2();
    const count = await ensureBuiltInBackgrounds(db, first.r2, { local: true });
    expect(count).toBe(studiosToInstall(true).length);
    const installed = await rows();
    expect(installed).toHaveLength(count);
    for (const row of installed) {
      expect(row).toMatchObject({ creatorId: null, status: "ready", failureCode: null });
      expect(row.imageKey && row.thumbKey && row.alt && row.width && row.height).toBeTruthy();
    }
    expect(first.puts).toHaveLength(count * 2);

    const second = fakeR2();
    const again = await ensureBuiltInBackgrounds(db, second.r2, { local: true });
    expect(await rows()).toHaveLength(count);
    // Cheap when everything is there: nothing is written or uploaded.
    expect(again).toBe(0);
    expect(second.puts).toHaveLength(0);
  });

  it("puts the studio back when a row was changed, keeping its ID", async () => {
    await ensureBuiltInBackgrounds(db, fakeR2().r2, { local: true });
    const target = studiosToInstall(true)[0]!;
    await db
      .update(background)
      .set({ name: "Changed", status: "failed" })
      .where(eq(background.id, target.id));
    await ensureBuiltInBackgrounds(db, fakeR2().r2, { local: true });
    const [row] = await db.select().from(background).where(eq(background.id, target.id));
    expect(row).toMatchObject({ name: target.name, status: "ready" });
  });

  it("installs nothing for a test only studio when the database is not local", async () => {
    await db.delete(background).where(inArray(background.id, ids));
    const none = fakeR2();
    const count = await ensureBuiltInBackgrounds(db, none.r2, { local: false });
    expect(count).toBe(studiosToInstall(false).length);
    // No placeholder row and no placeholder file reach a remote environment.
    expect((await rows()).filter((r) => r.name === "Studio blue")).toHaveLength(0);
    expect(none.puts.some((k) => k.includes("studio-placeholder"))).toBe(false);
    // Put the local studio back for the other tests of this run.
    await ensureBuiltInBackgrounds(db, fakeR2().r2, { local: true });
  });
});

describe("the cleanup task", () => {
  it("installs studios with local: false, never the local one", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./cleanup.ts", import.meta.url), "utf8");
    expect(source).toContain("ensureBuiltInBackgrounds(db, r2, { local: false })");
    expect(source).not.toMatch(/local:\s*true/);
  });

  it("ships the studio images with the Trigger.dev deploy", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync(new URL("../../trigger.config.ts", import.meta.url), "utf8");
    expect(config).toContain("additionalFiles");
    expect(config).toContain("./assets/backgrounds/*");
  });
});
