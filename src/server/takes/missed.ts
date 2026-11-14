import { missedSchema } from "@/lib/api-schemas/requests";
import { and, eq, gte, sql } from "drizzle-orm";
import { runTx } from "@/db/tx";
import { analyticsEvent, cut, take as takeTable } from "@/db/schema";
import { ok } from "@/lib/result";
import { MISSED_MARK } from "@/lib/cut-quality";
import { isExpired, removedMs } from "@/lib/take-media";
import { recordEvent } from "../analytics/record";
import { getForCreator } from "./index";
import { type TakeHttpDeps, errorResponse, guard, readBody } from "./http";

/** 00:00 UTC of the day `now` falls in. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * POST /api/takes/{id}/missed `{ atMs }` (spec 0017 AC-2 to AC-4): the creator pressed "Missed
 * something?" at the playhead. Origin 403, session 401, 404 for a missing or another creator's
 * take, 409 when the take is not ready or has expired, 422 for a bad or too late `atMs`, then 204.
 * Only a time is stored (rounded to 100 ms, with the edited length derived here); no cut row is
 * written and no job starts. The 21st mark of a take in a UTC day answers 204 without writing.
 */
export async function handleMissed(
  request: Request,
  takeId: string,
  deps: TakeHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const found = await getForCreator(creator.db, creator.creatorId, takeId);
  if (!found.ok) return errorResponse("not_found");
  const { take } = found.data;
  const at = deps.now?.() ?? new Date();
  if (take.status !== "ready" || isExpired(take, at)) return errorResponse("not_markable");
  const parsed = missedSchema.safeParse(await readBody(request));
  if (!parsed.success) return errorResponse("invalid");

  const cuts = await creator.db
    .select({ startMs: cut.startMs, endMs: cut.endMs })
    .from(cut)
    .where(and(eq(cut.takeId, take.id), eq(cut.applied, true)));
  const durationMs = Math.max(0, (take.durationMs ?? 0) - removedMs(cuts));
  if (parsed.data.atMs > durationMs) return errorResponse("invalid");

  // Rounded to 100 ms, then held to the last 100 ms boundary inside the video, so a length that
  // is not a multiple of 100 never stores an off-grid time.
  const atMs = Math.min(
    Math.round(parsed.data.atMs / 100) * 100,
    Math.floor(durationMs / 100) * 100,
  );
  try {
    // The take row lock serializes presses of one take, so the count and the insert cannot
    // interleave and two presses at 19 marks never make 21. Locking only the take follows the
    // lock order rule (src/db/AGENTS.md). The mark is best effort: a failure here is logged by
    // recordEvent (ids only) and the creator still gets the thank you.
    await runTx(creator.db, async (tx) => {
      await tx
        .select({ id: takeTable.id })
        .from(takeTable)
        .where(eq(takeTable.id, take.id))
        .for("update");
      const [today] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.takeId, take.id),
            eq(analyticsEvent.name, "cut_missed"),
            gte(analyticsEvent.occurredAt, utcDayStart(at)),
          ),
        );
      if ((today?.n ?? 0) < MISSED_MARK.perTakePerDay) {
        await recordEvent(tx, {
          name: "cut_missed",
          creatorId: creator.creatorId,
          takeId: take.id,
          props: { atMs, durationMs },
        });
      }
      return ok(true);
    });
  } catch {
    console.error("cut_missed transaction failed", { takeId: take.id });
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
