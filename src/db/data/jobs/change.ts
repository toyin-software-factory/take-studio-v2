import { and, asc, count, eq, gt, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { BACKGROUND_CHANGE } from "@/lib/background-rules";
import { type CutPlanEntry, effectiveRemovedRanges } from "@/lib/cut-rules";
import { ACTIVE_JOB_STATUSES, stepsFor } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { isExpired } from "@/lib/take-media";
import { keepRanges } from "@/lib/trim";
import { background, cut, processingJob, render, take, user } from "../../schema";
import type { Executor, Tx } from "../../types";
import { runStart, startJobRow } from "./start-shared";
import type { StartedJob } from "./types";

/** Stands for "keyed on a background that has since been deleted" when comparing targets. */
const DELETED_BACKGROUND = "deleted";

/**
 * LEGACY (HRF-T08): before the `background` kind existed every background change was a
 * `rerender` (a `rerender` never has a `trim` step, so the old "no trim step" rule matched all of
 * them), and those rows were not converted: they cannot be told from a `startJob` re render
 * afterwards. An old Worker may also start one during the deploy. The hourly count and the latest
 * change lookup therefore still treat a `rerender` as a possible background change. A later
 * cleanup task converts the rows and removes this with the `rerender` branch of
 * `isBackgroundChange`.
 */
export const legacyBackgroundRerender = sql`${processingJob.kind} = 'rerender'`;

export type ChangeStartError =
  | "not_found"
  | "invalid_transition"
  | "original_gone"
  | "job_active"
  | "nothing_changed"
  | "no_green_screen"
  | "background_change_limit"
  | "background_not_ready"
  | "background_missing"
  | "stale"
  | "invalid";

export type ChangeInput = {
  readonly creatorId: string;
  readonly takeId: string;
  /** The latest render the page loaded; absent only for the legacy `PUT /background`. */
  readonly baseRenderId?: string | null;
  /** Absent keeps the take's current background; `{ id: null }` is the original. */
  readonly background?: { readonly id: string | null };
  readonly cuts: readonly CutPlanEntry[];
  readonly now?: Date;
};

type LatestRender = {
  readonly id: string;
  readonly keyed: boolean;
  readonly backgroundId: string | null;
  readonly backgroundName: string | null;
};

async function latestRenderOf(tx: Tx, takeId: string): Promise<LatestRender | undefined> {
  const [latest] = await tx
    .select({
      id: render.id,
      keyed: render.keyed,
      backgroundId: render.backgroundId,
      backgroundName: render.backgroundName,
    })
    .from(render)
    .where(and(eq(render.takeId, takeId), eq(render.isLatest, true)));
  return latest;
}

/** The background a keyed render has, or null for the original (null is "no background"). */
const inheritedOf = (latest: LatestRender | undefined): string | null =>
  latest?.keyed ? latest.backgroundId : null;

/**
 * `startChangeJob` (spec 0011, "Server function"; replaces `startBackgroundJob` of spec 0008), one
 * transaction. It never moves the take and never charges; it starts a `background` job that
 * renders the take with a background and a set of cut changes (`cut_plan`) at once. Lock order
 * (src/db/AGENTS.md): creator, the background `FOR KEY SHARE` (the named one, or the one the
 * latest render is on), take `FOR UPDATE`, then the take's cuts. Refusals, in order: another
 * creator's or unknown background / take / cut (`not_found`), background `background_not_ready`,
 * `original_gone`, `invalid_transition`, `job_active`, `stale` (`baseRenderId` is not the latest
 * render), `nothing_changed`, `background_missing`, `invalid` (the plan removes the whole take),
 * `no_green_screen`, `background_change_limit` (10 an hour, shared by every change).
 * `cut.applied` is not touched here: `finishBackgroundJob` writes it when the render succeeds.
 */
export async function startChangeJob(
  db: Executor,
  input: ChangeInput,
): Promise<Result<StartedJob, ChangeStartError>> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  if (
    input.baseRenderId !== undefined &&
    input.baseRenderId !== null &&
    !z.uuid().safeParse(input.baseRenderId).success
  ) {
    return err("stale");
  }
  const named = input.background;
  if (named?.id != null && !z.uuid().safeParse(named.id).success) return err("not_found");
  if (!input.cuts.every((entry) => z.uuid().safeParse(entry.cutId).success)) {
    return err("not_found");
  }
  const now = input.now ?? new Date();

  return runStart<StartedJob, ChangeStartError>(db, "job_active", async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, input.creatorId)).for("update");

    // The background comes before the take in the lock order. A request that names none uses
    // the one the latest render is on, found by a first read and checked again under the lock.
    let peeked: string | null = null;
    if (named === undefined) {
      const [owned] = await tx
        .select({ id: take.id })
        .from(take)
        .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)));
      if (owned) peeked = inheritedOf(await latestRenderOf(tx, owned.id));
    }
    const lockId = named ? named.id : peeked;
    let lockedStatus: string | null = null;
    if (lockId !== null) {
      const [chosen] = await tx
        .select()
        .from(background)
        .where(eq(background.id, lockId))
        .for("key share");
      if (
        named?.id &&
        (!chosen || (chosen.creatorId !== null && chosen.creatorId !== input.creatorId))
      ) {
        return err("not_found");
      }
      lockedStatus = chosen?.status ?? null;
    }
    if (named?.id && lockedStatus !== "ready") return err("background_not_ready");

    const [current] = await tx
      .select()
      .from(take)
      .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)))
      .for("update");
    if (!current) return err("not_found");
    if (isExpired(current, now)) return err("original_gone");
    if (current.status !== "ready") return err("invalid_transition");

    const [active] = await tx
      .select({ id: processingJob.id })
      .from(processingJob)
      .where(
        and(
          eq(processingJob.takeId, current.id),
          inArray(processingJob.status, ACTIVE_JOB_STATUSES),
        ),
      );
    if (active) return err("job_active");

    const latest = await latestRenderOf(tx, current.id);
    if (input.baseRenderId !== undefined && input.baseRenderId !== (latest?.id ?? null)) {
      return err("stale");
    }

    const cuts = await tx
      .select({ id: cut.id, startMs: cut.startMs, endMs: cut.endMs, applied: cut.applied })
      .from(cut)
      .where(eq(cut.takeId, current.id))
      .orderBy(asc(cut.startMs));
    const stored = new Map(cuts.map((c) => [c.id, c.applied]));
    const plan: CutPlanEntry[] = [];
    for (const entry of input.cuts) {
      if (!stored.has(entry.cutId)) return err("not_found");
      // An entry that matches the stored state is no change (a stale tab, or a repeat).
      if (stored.get(entry.cutId) !== entry.applied && !plan.some((p) => p.cutId === entry.cutId)) {
        plan.push(entry);
      }
    }

    // Three states: a background, the original, or deleted (keyed, reference gone), which equals
    // nothing, so asking for the original on such a take is a real change.
    const effective = latest?.keyed ? (latest.backgroundId ?? DELETED_BACKGROUND) : null;
    const backgroundChanged = named !== undefined && named.id !== effective;
    if (!backgroundChanged && plan.length === 0) return err("nothing_changed");

    let target: string | null;
    if (named !== undefined) {
      target = named.id;
    } else {
      if (latest?.keyed && latest.backgroundId === null) return err("background_missing");
      target = inheritedOf(latest);
      if (target !== peeked) return err("stale"); // the render changed between the two reads
      if (target !== null && lockedStatus !== "ready") return err("background_not_ready");
    }

    const removed = effectiveRemovedRanges(cuts, plan);
    if (current.durationMs === null || keepRanges(removed, current.durationMs).length === 0) {
      return err("invalid");
    }

    // The last render found no green screen: a real background would show nowhere.
    if (
      backgroundChanged &&
      target !== null &&
      latest?.backgroundName != null &&
      latest.keyed === false
    ) {
      return err("no_green_screen");
    }

    // One limit for every change: `background` jobs started in the last hour (failed ones and
    // retries count), plus the LEGACY `rerender` rows (HRF-T08).
    const [recent] = await tx
      .select({ n: count() })
      .from(processingJob)
      .innerJoin(take, eq(take.id, processingJob.takeId))
      .where(
        and(
          eq(take.creatorId, input.creatorId),
          or(eq(processingJob.kind, "background"), legacyBackgroundRerender),
          gt(processingJob.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= BACKGROUND_CHANGE.perHour) return err("background_change_limit");

    const started = await startJobRow(tx, {
      job: {
        takeId: current.id,
        kind: "background",
        targetBackgroundId: target,
        cutPlan: plan.length > 0 ? plan : null,
        secondsCharged: 0,
        chargedMonth: null,
        chargedAccountHash: null,
      },
      stepNames: stepsFor("background", { hasBackground: target !== null }),
    });
    return started ? ok(started) : err("job_active");
  });
}
