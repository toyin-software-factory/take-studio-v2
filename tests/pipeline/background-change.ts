/** Previews and a background change (AC-4 to AC-6). Called from background.ts. */
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db } from "./harness";
import { frameStats } from "./inspect";
import { until, waitIdle } from "./wait";
import { type Env, S, STUDIO } from "./background-env";

export async function changeScenarios(
  env: Env,
  keyed: string | undefined,
  warm: string | undefined,
): Promise<void> {
  const { ctx, c, b, check, takeOf, charged } = env;
  // Previews (AC-4).
  try {
    if (keyed && warm) {
      await waitIdle(keyed);
      const started = Date.now();
      const first = await c.api("POST", `/api/takes/${keyed}/background/preview`, {
        backgroundId: warm,
      });
      check(
        S,
        "AC-4: a preview request is accepted (202 making)",
        first.status === 202 && first.json.state === "making",
        first,
      );
      const ready = await until(
        async () =>
          (await c.api("GET", `/api/takes/${keyed}/background/preview?backgroundId=${warm}`)).json,
        (j) => j.state !== "making",
        90,
      );
      const seconds = (Date.now() - started) / 1000;
      check(
        S,
        `AC-4: the preview is ready in ${seconds.toFixed(1)} s (about 20 s expected)`,
        ready?.state === "ready" && seconds <= 30,
        ready,
      );
      const image = ready?.url ? await fetch(String(ready.url)) : null;
      check(
        S,
        "AC-4: its link serves a JPEG",
        image?.status === 200 && (image.headers.get("content-type") ?? "").includes("jpeg"),
        image?.status,
      );
      const again = await c.api("POST", `/api/takes/${keyed}/background/preview`, {
        backgroundId: warm,
      });
      check(
        S,
        "AC-4: asking again is a cache hit (200 ready)",
        again.status === 200 && again.json.state === "ready",
        again,
      );
      const foreign = await b.api("POST", `/api/takes/${keyed}/background/preview`, {
        backgroundId: warm,
      });
      check(S, "AC-9: another creator can't preview (404)", foreign.status === 404, foreign.status);
    }
  } catch (error) {
    check(S, "Previews ran", false, String(error));
  }

  // A background change keeps the take Ready and costs nothing (AC-5, AC-6).
  try {
    if (keyed && warm) {
      await waitIdle(keyed);
      const before = await charged(keyed);
      const [first] = (
        await db.select().from(schema.render).where(eq(schema.render.takeId, keyed))
      ).filter((x) => x.isLatest);
      const change = await c.api("PUT", `/api/takes/${keyed}/background`, { backgroundId: warm });
      check(S, "AC-5: the change is accepted (202)", change.status === 202, change);
      const busy = await c.api("PUT", `/api/takes/${keyed}/background`, {
        backgroundId: "original",
      });
      check(
        S,
        "AC-6: another change while one runs is refused (409 job_active)",
        busy.status === 409 && busy.json.error === "job_active",
        busy,
      );
      const inUse = await c.api("DELETE", `/api/backgrounds/${warm}`);
      check(
        S,
        "AC-10: deleting a background a running job renders onto is refused (409 in_use)",
        inUse.status === 409 && inUse.json.error === "in_use",
        inUse,
      );
      const readyAll: string[] = [];
      const done = await until(
        async () => {
          const t = await takeOf(keyed!);
          readyAll.push(t.take.status);
          return t;
        },
        (t) => t.backgroundJob?.status === "succeeded" || t.backgroundJob?.status === "failed",
        240,
      );
      check(
        S,
        "AC-5: the change succeeded",
        done?.backgroundJob?.status === "succeeded",
        done?.backgroundJob,
      );
      check(
        S,
        `AC-5: the take stayed Ready in all ${readyAll.length} polls`,
        readyAll.every((s) => s === "ready"),
        readyAll,
      );
      check(
        S,
        "AC-5: the page names the new background",
        done?.background?.name === "Pipeline warm" && done.background.keyed,
        done?.background,
      );
      const [after] = (
        await db.select().from(schema.render).where(eq(schema.render.takeId, keyed))
      ).filter((x) => x.isLatest);
      check(
        S,
        "AC-5: a new render is current, on the uploaded background",
        after?.id !== first?.id && after?.backgroundId === warm && after.keyed,
        { id: after?.id, bg: after?.backgroundId },
      );
      check(S, "AC-5: nothing was charged", (await charged(keyed)) === before, {
        before,
        after: await charged(keyed),
      });
      const warmFrame = frameStats(await ctx.downloadRender(c, keyed));
      check(
        S,
        "AC-5: the video is on the warm studio, no green left",
        warmFrame.greenShare === 0 && warmFrame.corner.r > warmFrame.corner.b,
        warmFrame,
      );

      await waitIdle(keyed);
      const same = await c.api("PUT", `/api/takes/${keyed}/background`, { backgroundId: warm });
      check(
        S,
        "AC-6: the same background again is refused (409 same_background)",
        same.status === 409 && same.json.error === "same_background",
        same,
      );
      const foreign = await b.api("PUT", `/api/takes/${keyed}/background`, {
        backgroundId: STUDIO.id,
      });
      check(S, "AC-6: another creator gets 404", foreign.status === 404, foreign.status);
      const gif = await c.api("PUT", `/api/takes/${keyed}/background`, {
        backgroundId: "not-an-id",
      });
      check(S, "AC-6: a bad background ID is refused (422)", gif.status === 422, gif.status);

      // And back to the original.
      const back = await c.api("PUT", `/api/takes/${keyed}/background`, {
        backgroundId: "original",
      });
      check(S, "AC-5: change back to the original is accepted", back.status === 202, back);
      const home = await until(
        async () => takeOf(keyed!),
        (t) => t.backgroundJob?.status === "succeeded" || t.backgroundJob?.status === "failed",
        240,
      );
      const [plain] = (
        await db.select().from(schema.render).where(eq(schema.render.takeId, keyed))
      ).filter((x) => x.isLatest);
      check(
        S,
        "AC-5: the original comes back: plain render, no background on the page",
        home?.backgroundJob?.status === "succeeded" &&
          plain?.keyed === false &&
          home.background === null,
        { job: home?.backgroundJob, keyed: plain?.keyed },
      );
      const green = frameStats(await ctx.downloadRender(c, keyed));
      check(
        S,
        "AC-5: the frame is the original green screen again",
        green.corner.g > green.corner.r && green.corner.g > green.corner.b,
        green.corner,
      );
    }
  } catch (error) {
    check(S, "Background change ran", false, String(error));
  }
}
