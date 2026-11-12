/**
 * Background checks for the pipeline run (spec 0008 build plan step 7): a studio chosen at
 * upload and keyed in the video job (AC-2), a take with no green screen (AC-3), previews (AC-4),
 * re renders that keep the take Ready and charge nothing (AC-5, AC-6), uploaded backgrounds with
 * the refusals that need real R2 (AC-8, AC-9) and their deletion (AC-10). Real R2 and
 * Trigger.dev dev, tiny synthetic fixtures. Called from run.ts with its helpers, so the services
 * and the creators are shared.
 */
import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { BUILT_IN_BACKGROUNDS } from "@/lib/built-in-backgrounds";
import { drainDeletions } from "../../src/db/data/deletion";
import * as schema from "../../src/db/schema";
import { type Creator, db, r2 } from "./harness";
import { frameStats } from "./inspect";

export type Ctx = {
  readonly c: Creator;
  /** Another creator, for the ownership checks. */
  readonly b: Creator;
  readonly check: (scenario: string, name: string, ok: boolean, detail?: unknown) => void;
  readonly upload: (
    creator: Creator,
    file: string,
    container: "mp4" | "mov",
    backgroundId?: string,
  ) => Promise<string>;
  readonly waitFinal: (creator: Creator, takeId: string) => Promise<unknown>;
  readonly downloadRender: (creator: Creator, takeId: string) => Promise<string>;
  readonly media: (file: string) => string;
};

type Item = { id: string; name: string; status: string; thumbUrl: string | null };
type List = { builtIn: Item[]; mine: Item[]; defaultId: string | null };
type TakeJson = {
  take: { status: string };
  background: { id: string | null; name: string; keyed: boolean } | null;
  noGreenScreen: boolean;
  backgroundJob: { status: string; failureCode: string | null } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STUDIO = BUILT_IN_BACKGROUNDS[0]!;
const S = "background";

/** Waits (polling every 2 s) until `done` says so; null on timeout. */
async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, seconds: number) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) return null;
    await sleep(2_000);
  }
}

export async function backgroundScenarios(ctx: Ctx): Promise<void> {
  const { c, b, check } = ctx;
  const list = async (who: Creator = c) =>
    (await who.api("GET", "/api/backgrounds")).json as unknown as List;
  const takeOf = async (id: string) =>
    (await c.api("GET", `/api/takes/${id}`)).json as unknown as TakeJson;
  const jobsOf = (takeId: string) =>
    db.select().from(schema.processingJob).where(eq(schema.processingJob.takeId, takeId));
  const waitIdle = async (takeId: string) => {
    const idle = await until(
      jobsOf.bind(null, takeId),
      (jobs) => jobs.every((j) => !["queued", "running"].includes(j.status)),
      240,
    );
    if (!idle) throw new Error("the take still has a running job after 4 minutes");
  };
  const charged = async (takeId: string) =>
    (await jobsOf(takeId)).filter((j) => !j.refunded).reduce((n, j) => n + j.secondsCharged, 0);

  /** An uploaded background: create, PUT the bytes to R2, complete, wait for the ingest. */
  async function uploadBackground(who: Creator, name: string, file: string, type = "image/jpeg") {
    const bytes = readFileSync(ctx.media(file));
    const created = await who.api("POST", "/api/backgrounds", {
      name,
      contentType: type,
      bytes: bytes.length,
    });
    if (created.status !== 201) throw new Error(`create ${name}: ${created.status}`);
    const { id, uploadUrl } = created.json as { id: string; uploadUrl: string };
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": type },
      body: bytes,
    });
    if (!put.ok) throw new Error(`put ${name}: ${put.status}`);
    const done = await who.api("POST", `/api/backgrounds/${id}/complete`);
    if (done.status !== 200) throw new Error(`complete ${name}: ${done.status}`);
    const final = await until(
      async () => (await list(who)).mine.find((m) => m.id === id),
      (m) => m !== undefined && !["uploading", "processing"].includes(m.status),
      120,
    );
    return { id, item: final ?? undefined };
  }

  // The built in studio is listed, and nothing is the default yet.
  try {
    const before = await list();
    check(
      S,
      "AC-7: the built in studio is listed, ready, with a thumbnail",
      before.builtIn.some((x) => x.id === STUDIO.id && x.status === "ready" && !!x.thumbUrl),
      before.builtIn.map((x) => x.name),
    );
    check(S, "AC-1: no default background yet", before.defaultId === null, before.defaultId);
    const thumb = await fetch(
      before.builtIn.find((x) => x.id === STUDIO.id)?.thumbUrl ?? "x:",
    ).catch(() => null);
    check(
      S,
      "AC-7: the studio's thumbnail link works (WebP)",
      thumb?.status === 200 && (thumb.headers.get("content-type") ?? "").includes("webp"),
      thumb?.status,
    );
  } catch (error) {
    check(S, "listing ran", false, String(error));
  }

  // Uploaded backgrounds: accepted, refused, private (AC-8, AC-9).
  let warm: string | undefined;
  try {
    const up = await uploadBackground(c, "Pipeline warm", "bg-ok.jpg");
    warm = up.id;
    check(
      S,
      "AC-8: a 1280x720 JPEG is accepted and ready",
      up.item?.status === "ready",
      up.item?.status,
    );
    const mine = (await list()).mine.find((m) => m.id === up.id);
    const thumb = await fetch(mine?.thumbUrl ?? "x:").catch(() => null);
    check(
      S,
      "AC-8: its thumbnail is a WebP",
      thumb?.status === 200 && (thumb.headers.get("content-type") ?? "").includes("webp"),
      thumb?.status,
    );

    const small = await uploadBackground(c, "Too small", "bg-small.jpg");
    const [smallRow] = await db
      .select()
      .from(schema.background)
      .where(eq(schema.background.id, small.id));
    check(
      S,
      "AC-8: a 640x360 image is refused as image_too_small",
      smallRow?.status === "failed" && smallRow.failureCode === "image_too_small",
      { status: smallRow?.status, code: smallRow?.failureCode },
    );
    const fake = await uploadBackground(c, "Not an image", "bg-fake.jpg");
    const [fakeRow] = await db
      .select()
      .from(schema.background)
      .where(eq(schema.background.id, fake.id));
    check(
      S,
      "AC-8: bytes that are not an image are refused as image_invalid",
      fakeRow?.status === "failed" && fakeRow.failureCode === "image_invalid",
      { status: fakeRow?.status, code: fakeRow?.failureCode },
    );

    const gif = await c.api("POST", "/api/backgrounds", {
      name: "gif",
      contentType: "image/gif",
      bytes: 1000,
    });
    check(
      S,
      "AC-8: a GIF is refused (422 unsupported_type)",
      gif.status === 422 && gif.json.error === "unsupported_type",
      gif,
    );
    const huge = await c.api("POST", "/api/backgrounds", {
      name: "huge",
      contentType: "image/jpeg",
      bytes: 11 * 1024 * 1024,
    });
    check(
      S,
      "AC-8: over 10 MB is refused (422 too_large)",
      huge.status === 422 && huge.json.error === "too_large",
      huge,
    );

    // A wrong declared length: the signed PUT pins the exact length, so R2 itself refuses it.
    const bytes = readFileSync(ctx.media("bg-ok.jpg"));
    const wrong = await c.api("POST", "/api/backgrounds", {
      name: "Wrong length",
      contentType: "image/jpeg",
      bytes: bytes.length + 7,
    });
    const { id: wrongId, uploadUrl } = wrong.json as { id: string; uploadUrl: string };
    const sent = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: bytes,
    });
    check(
      S,
      "AC-8: R2 refuses a PUT whose length differs from the declared one",
      !sent.ok,
      sent.status,
    );
    const incomplete = await c.api("POST", `/api/backgrounds/${wrongId}/complete`);
    check(
      S,
      "AC-8: completing it is refused (409 not_uploaded)",
      incomplete.status === 409 && incomplete.json.error === "not_uploaded",
      incomplete,
    );

    // Private to the owner (AC-9).
    check(
      S,
      "AC-9: another creator doesn't see it",
      !(await list(b)).mine.some((m) => m.id === up.id),
      "",
    );
    const del = await b.api("DELETE", `/api/backgrounds/${up.id}`);
    check(S, "AC-9: another creator can't delete it (404)", del.status === 404, del.status);
    const builtIn = await c.api("DELETE", `/api/backgrounds/${STUDIO.id}`);
    check(
      S,
      "AC-9: a built in studio can't be deleted (404)",
      builtIn.status === 404,
      builtIn.status,
    );
  } catch (error) {
    check(S, "Uploaded backgrounds ran", false, String(error));
  }

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

  // Deleting an uploaded background: its files go, a take that used it keeps its video (AC-10).
  try {
    if (keyed && warm) {
      await waitIdle(keyed);
      const change = await c.api("PUT", `/api/takes/${keyed}/background`, { backgroundId: warm });
      check(
        S,
        "AC-10: a take is put on the uploaded background again",
        change.status === 202,
        change,
      );
      await until(
        async () => takeOf(keyed!),
        (t) => t.backgroundJob?.status === "succeeded" || t.backgroundJob?.status === "failed",
        240,
      );
      await waitIdle(keyed);
      const [row] = await db.select().from(schema.background).where(eq(schema.background.id, warm));
      const keys = [row?.sourceKey, row?.imageKey, row?.thumbKey].filter((k): k is string => !!k);
      const removed = await c.api("DELETE", `/api/backgrounds/${warm}`);
      check(S, "AC-10: deleting it works (204)", removed.status === 204, removed.status);
      check(S, "AC-10: it leaves the library", !(await list()).mine.some((m) => m.id === warm), "");
      const queued = await db
        .select()
        .from(schema.storageDeletion)
        .where(inArray(schema.storageDeletion.objectKey, keys));
      check(
        S,
        "AC-10: all its files are queued for deletion",
        queued.length === keys.length && keys.length === 3,
        { keys: keys.length, queued: queued.length },
      );
      await drainDeletions(db, (k) => r2.deleteObject(k));
      const left = (await Promise.all(keys.map((k) => r2.headObject(k)))).filter(Boolean).length;
      check(S, "AC-10: the files are gone from R2 after the queue drains", left === 0, left);
      const t = await takeOf(keyed);
      const media = await c.api("GET", `/api/takes/${keyed}/media?kind=play`);
      check(
        S,
        "AC-10: the take keeps its video and shows the background's name",
        media.status === 200 && t.background?.name === "Pipeline warm",
        { media: media.status, bg: t.background },
      );
      const again = await c.api("DELETE", `/api/backgrounds/${warm}`);
      check(S, "AC-10: deleting it again is 404", again.status === 404, again.status);
      const next = await c.api("PUT", `/api/takes/${keyed}/background`, { backgroundId: warm });
      check(
        S,
        "AC-6: a deleted background can't be picked (404)",
        next.status === 404,
        next.status,
      );
    }
  } catch (error) {
    check(S, "Deletion ran", false, String(error));
  }
}
