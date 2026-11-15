/** A green screen take with the built in studio, and a take with no green screen (AC-1 to AC-3). Called from background.ts. */
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db } from "./harness";
import { frameStats } from "./inspect";
import { type Env, S, STUDIO } from "./background-env";

export async function takeScenarios(env: Env): Promise<string | undefined> {
  const { ctx, c, check, list, takeOf, jobsOf } = env;
  // A green screen take with the built in studio chosen at upload (AC-1, AC-2).
  let keyed: string | undefined;
  try {
    keyed = await ctx.upload(c, "keyed-landscape.mp4", "mp4", STUDIO.id);
    await ctx.waitFinal(c, keyed);
    const t = await takeOf(keyed);
    check(S, "AC-2: the green screen take is Ready", t.take.status === "ready", t.take.status);
    const [r] = (
      await db.select().from(schema.render).where(eq(schema.render.takeId, keyed))
    ).filter((x) => x.isLatest);
    check(
      S,
      "AC-2: the render is keyed on the studio",
      r?.keyed === true && r.backgroundId === STUDIO.id && !!r.keyColor,
      { keyed: r?.keyed, key: r?.keyColor },
    );
    check(
      S,
      "AC-2: the page names the studio",
      t.background?.name === STUDIO.name && t.background.keyed,
      t.background,
    );
    const steps = await db.select().from(schema.jobStep).where(eq(schema.jobStep.jobId, r!.jobId));
    check(
      S,
      "AC-2: the background step succeeded",
      steps.some((s) => s.name === "background" && s.status === "succeeded"),
      steps.map((s) => `${s.name}:${s.status}`),
    );
    const file = await ctx.downloadRender(c, keyed);
    const f = frameStats(file);
    check(
      S,
      "AC-2: no green is left in the frame, the studio shows",
      f.greenShare === 0 && f.corner.b > f.corner.r,
      f,
    );
    check(S, "AC-1: the choice became the default", (await list()).defaultId === STUDIO.id, "");
  } catch (error) {
    check(S, "Green screen take ran", false, String(error));
  }

  // A take with no green screen keeps its background and says so (AC-3).
  try {
    const none = await ctx.upload(c, "nogreen-none.mp4", "mp4", STUDIO.id);
    await ctx.waitFinal(c, none);
    const t = await takeOf(none);
    const [r] = (
      await db.select().from(schema.render).where(eq(schema.render.takeId, none))
    ).filter((x) => x.isLatest);
    check(
      S,
      "AC-3: Ready, not keyed, the page says there is no green screen",
      t.take.status === "ready" && r?.keyed === false && t.noGreenScreen && t.background === null,
      { status: t.take.status, keyed: r?.keyed, note: t.noGreenScreen },
    );
    const steps = await db.select().from(schema.jobStep).where(eq(schema.jobStep.jobId, r!.jobId));
    check(
      S,
      "AC-3: the background step skipped with no_green_screen",
      steps.some(
        (s) =>
          s.name === "background" && s.status === "skipped" && s.failureCode === "no_green_screen",
      ),
      steps.map((s) => `${s.name}:${s.status}:${s.failureCode}`),
    );
    const [job] = await jobsOf(none);
    const [row] = await db.select().from(schema.take).where(eq(schema.take.id, none));
    check(
      S,
      "AC-3: the charge is the usual one",
      job?.secondsCharged === Math.ceil((row?.durationMs ?? 0) / 1000),
      job?.secondsCharged,
    );
    const f = frameStats(await ctx.downloadRender(c, none));
    check(
      S,
      "AC-3: the original wall is kept (grey, not the studio)",
      Math.abs(f.corner.r - f.corner.b) < 20,
      f.corner,
    );
  } catch (error) {
    check(S, "No green screen take ran", false, String(error));
  }
  return keyed;
}
