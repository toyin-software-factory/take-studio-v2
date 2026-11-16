import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish, markRunning, startJob } from "@/db/data/jobs";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import { ok } from "@/lib/result";
import type { OutgoingEmail } from "@/lib/email/send";
import { user } from "@/db/schema";
import { seedTake } from "@/db/testing/test-db";
import { guestEmail } from "@/lib/guest-rules";
import { notifyTakeFinished } from "./notify";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_claim_email" });
});
afterAll(() => testDb?.close());

describe("no email to a guest address (spec 0023, AC-7)", () => {
  it("a job that finishes before the claim sends nothing, ok or failed", async () => {
    for (const status of ["succeeded", "failed"] as const) {
      const guestId = `guest-${crypto.randomUUID()}`;
      await testDb.db.insert(user).values({
        id: guestId,
        name: "Guest",
        email: guestEmail(guestId),
        takeEmails: false,
        guest: true,
      });
      const t = await seedTake(testDb.db, guestId, { guestOrigin: true });
      const job = await startJob(testDb.db, {
        creatorId: guestId,
        takeId: t.id,
        usageSecret: "test-usage-hash-secret-0123456789abcdef",
      });
      if (!job.ok) throw new Error(job.error);
      await markRunning(testDb.db, { jobId: job.data.id, triggerRunId: "run_guest" });
      await finish(testDb.db, {
        jobId: job.data.id,
        status,
        ...(status === "failed" ? { failureCode: "ffmpeg_error" as const } : {}),
      });
      const sent: OutgoingEmail[] = [];
      const deps = {
        sendEmail: async (mail: OutgoingEmail) => {
          sent.push(mail);
          return ok({ id: "e" });
        },
        baseUrl: "https://app.example.com",
        linkSecret: "test-email-link-secret-0123456789abcdef",
      };
      expect(await notifyTakeFinished(testDb.db, job.data.id, deps)).toEqual(ok("emails_off"));
      expect(sent).toHaveLength(0);
    }
  });
});
