/** Expired and deleted takes (AC-10). Called from transcript.ts. */
import { eq } from "drizzle-orm";
import { expireDueTakes } from "../../src/db/data/cleanup";
import { finish, startTranscribeJob } from "../../src/db/data/jobs";
import * as schema from "../../src/db/schema";
import { deleteTake } from "../../src/server/takes";
import { db } from "./harness";
import { type Ctx, rowsOf, view, waitTranscript } from "./transcript-env";

export async function expiryScenarios(
  ctx: Ctx,
  english: string | undefined,
  quiet: string | undefined,
): Promise<void> {
  const { check } = ctx;
  const a = ctx.t;
  const S = "transcript";
  try {
    if (quiet) {
      // Expiry waits for an active transcribe job, then goes through.
      const started = await startTranscribeJob(db, { takeId: quiet });
      check(
        S,
        "AC-10: a transcribe job can start on a take that is about to expire",
        started.ok,
        started,
      );
      const past = new Date(Date.now() - 60_000);
      await db.update(schema.take).set({ videoExpiresAt: past }).where(eq(schema.take.id, quiet));
      await expireDueTakes(db, new Date());
      const [waiting] = await db.select().from(schema.take).where(eq(schema.take.id, quiet));
      check(
        S,
        "AC-10: expiry waits while the transcribe job is active",
        waiting?.status === "ready",
        waiting?.status,
      );
      if (started.ok) await finish(db, { jobId: started.data.id, status: "succeeded" });
      await expireDueTakes(db, new Date());
      const [done] = await db.select().from(schema.take).where(eq(schema.take.id, quiet));
      check(
        S,
        "AC-10: it expires on the next sweep once the job ended",
        done?.status === "expired",
        done?.status,
      );
    }
    if (english) {
      await db
        .update(schema.take)
        .set({ videoExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.take.id, english));
      await expireDueTakes(db, new Date());
      const [row] = await db.select().from(schema.take).where(eq(schema.take.id, english));
      check(S, "AC-10: the English take expired", row?.status === "expired", row?.status);
      const v = await view(a, english);
      check(
        S,
        "AC-10: the transcript is still shown, Make transcript hidden",
        v.state === "ready" && (v.paragraphs?.length ?? 0) > 0 && v.canMake === false,
        { state: v.state, canMake: v.canMake },
      );
      const srt = await a.raw("GET", `/api/takes/${english}/transcript/srt`);
      const txt = await a.raw("GET", `/api/takes/${english}/transcript/txt`);
      check(
        S,
        "AC-10: downloads still work on an expired take",
        srt.status === 200 && txt.status === 200,
        [srt.status, txt.status],
      );
      const make = await a.api("POST", `/api/takes/${english}/transcript`);
      check(S, "AC-10: Make transcript refused on an expired take", make.status === 409, make);
    }
  } catch (error) {
    check(S, "Expiry ran", false, String(error));
  }

  // Deleted take: AC-10.
  try {
    const doomed = await ctx.upload(a, "speech-en.mp4", "mp4");
    await ctx.waitFinal(a, doomed);
    const v = await waitTranscript(a, doomed);
    check(
      S,
      "deleted take: the transcript exists first",
      v.state === "ready" && (await rowsOf(doomed)).length === 1,
      v.state,
    );
    const deleted = await deleteTake(db, a.id, doomed, {
      cancelRuns: async () => {},
      requestStorageDrain: async () => {},
    });
    check(
      S,
      "AC-10: deleting the take deletes its transcript",
      deleted.ok && (await rowsOf(doomed)).length === 0,
      deleted.ok,
    );
    check(S, "deleted take: the route says 404", (await view(a, doomed)).status === 404, "");
  } catch (error) {
    check(S, "Deleted take ran", false, String(error));
  }
}
