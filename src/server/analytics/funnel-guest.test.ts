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

  it("counts the four guest events, with no personal data (AC-12)", async () => {
    const before = (await funnel(db, "all")).guest;
    await recordEvent(db, { name: "guest_drop", creatorId: null });
    await recordEvent(db, { name: "guest_email_added", creatorId: null });
    await recordEvent(db, { name: "guest_expired", creatorId: null, props: { hadEmail: true } });
    await recordEvent(db, { name: "guest_expired", creatorId: null, props: { hadEmail: false } });
    const g = (await funnel(db, "all")).guest;
    expect(g.drops - before.drops).toBe(1);
    expect(g.emailsAdded - before.emailsAdded).toBe(1);
    expect(g.expired - before.expired).toBe(2);
    expect(g.expiredWithEmail - before.expiredWithEmail).toBe(1);
  });

  it("accepts a null creator only for the three guest events", async () => {
    expect((await recordEvent(db, { name: "take_downloaded", creatorId: null } as never)).ok).toBe(
      false,
    );
    expect(
      (
        await recordEvent(db, {
          name: "guest_drop",
          creatorId: null,
          props: { email: "x" },
        } as never)
      ).ok,
    ).toBe(false);
  });
});
