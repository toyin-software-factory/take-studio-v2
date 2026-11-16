import { afterAll, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import { openTestDb, seedTake } from "@/db/testing/test-db";
import { guestEmail } from "@/lib/guest-rules";
import { recordEvent } from "./record";
import { foundingMembers, funnel } from "./report";

const test = await openTestDb({ database: "take_studio_test_analytics_funnel_guest" });
const { db } = test;
afterAll(() => test.close());

describe("guest accounts in the counts (spec 0023, G5)", () => {
  it("never change the signup, creator or founding member counts", async () => {
    const before = { funnel: await funnel(db, "all"), founding: await foundingMembers(db) };
    const id = crypto.randomUUID();
    await db
      .insert(user)
      .values({ id, name: "Guest", email: guestEmail(id), guest: true, takeEmails: false });
    for (let i = 0; i < 2; i++) {
      const t = await seedTake(db, id);
      await recordEvent(db, { name: "take_uploaded", creatorId: id, takeId: t.id });
    }
    expect(await funnel(db, "all")).toEqual(before.funnel);
    expect(await foundingMembers(db)).toEqual(before.founding);
  });
});
