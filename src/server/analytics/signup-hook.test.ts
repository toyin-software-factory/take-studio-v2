import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { analyticsEvent } from "@/db/schema";
import { openTestDb } from "@/db/testing/test-db";
import { createAuth } from "../auth";

// Test values only.
const ENV = {
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
};

const test = await openTestDb({ database: "take_studio_test_analytics" });
afterAll(async () => {
  await test.close();
});

describe("signup event from the user create hook (spec 0016, AC-4)", () => {
  it("records one signup with the creator ID and no personal field", async () => {
    const ctx = await createAuth(test.db, ENV).$context;
    const email = `hook-${crypto.randomUUID()}@example.com`;
    const created = await ctx.internalAdapter.createUser(
      { email, name: "Hook Person", emailVerified: false },
      { method: "magic-link" },
    );
    const rows = await test.db
      .select()
      .from(analyticsEvent)
      .where(eq(analyticsEvent.creatorId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "signup", takeId: null, props: {} });
    expect(JSON.stringify(rows[0])).not.toContain(email);
    expect(JSON.stringify(rows[0])).not.toContain("Hook Person");
  });
});
