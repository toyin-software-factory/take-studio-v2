import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTakeEmails } from "@/db/data/email-prefs";
import { finish, markRunning, startJob as start } from "@/db/data/jobs";
import { processingJob } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { OutgoingEmail } from "@/lib/email/send";
import { err, ok } from "@/lib/result";
import { notifyTakeFinished } from "./notify";

const SECRET = "test-usage-hash-secret-0123456789abcdef";
const LINK_SECRET = "test-email-link-secret-0123456789abcdef";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

function fakeSender(fail = false) {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    deps: {
      sendEmail: async (mail: OutgoingEmail) => {
        if (fail) return err("unavailable" as const);
        sent.push(mail);
        return ok({ id: "email_1" });
      },
      baseUrl: "https://app.example.com",
      linkSecret: LINK_SECRET,
    },
  };
}

async function finishedJob(status: "succeeded" | "failed") {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id);
  const job = await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  await markRunning(db, { jobId: job.data.id, triggerRunId: "run_notify" });
  await finish(db, {
    jobId: job.data.id,
    status,
    ...(status === "failed" ? { failureCode: "ffmpeg_error" as const } : {}),
  });
  return { creator, jobId: job.data.id };
}

describe("notifyTakeFinished (spec 0006, AC-5, AC-6, AC-8)", () => {
  it("sends one email per job even when called twice, and marks the job notified", async () => {
    const { creator, jobId } = await finishedJob("succeeded");
    const { sent, deps } = fakeSender();
    expect(await notifyTakeFinished(db, jobId, deps)).toEqual(ok("sent"));
    expect(await notifyTakeFinished(db, jobId, deps)).toEqual(ok("already_sent"));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(creator.email);
    expect(sent[0]?.idempotencyKey).toBe(`take-email-${jobId}`);
    expect(sent[0]?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toContain(
      "https://app.example.com/emails/off?u=",
    );
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, jobId));
    expect(row?.notifiedAt).toBeInstanceOf(Date);
  });

  it("sends the didn't finish email for a failed job", async () => {
    const { jobId } = await finishedJob("failed");
    const { sent, deps } = fakeSender();
    expect(await notifyTakeFinished(db, jobId, deps)).toEqual(ok("sent"));
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when the creator turned emails off", async () => {
    const { creator, jobId } = await finishedJob("succeeded");
    await setTakeEmails(db, creator.id, false);
    const { sent, deps } = fakeSender();
    expect(await notifyTakeFinished(db, jobId, deps)).toEqual(ok("emails_off"));
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a job that is not final yet or doesn't exist", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const job = await start(db, { creatorId: creator.id, takeId: t.id, usageSecret: SECRET });
    if (!job.ok) throw new Error(job.error);
    const { sent, deps } = fakeSender();
    expect(await notifyTakeFinished(db, job.data.id, deps)).toEqual(ok("not_final"));
    expect(await notifyTakeFinished(db, crypto.randomUUID(), deps)).toEqual(ok("not_found"));
    expect(sent).toHaveLength(0);
  });

  it("returns send_failed and leaves the job unnotified so the task can retry", async () => {
    const { jobId } = await finishedJob("succeeded");
    expect(await notifyTakeFinished(db, jobId, fakeSender(true).deps)).toEqual(err("send_failed"));
    const [row] = await db.select().from(processingJob).where(eq(processingJob.id, jobId));
    expect(row?.notifiedAt).toBeNull();
    expect(await notifyTakeFinished(db, jobId, fakeSender().deps)).toEqual(ok("sent"));
  });
});
