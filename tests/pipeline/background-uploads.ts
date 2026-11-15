/** The built in studio listing and the uploaded backgrounds (AC-7, AC-8, AC-9). Called from background.ts. */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db } from "./harness";
import { type Env, S, STUDIO } from "./background-env";

export async function uploadScenarios(env: Env): Promise<string | undefined> {
  const { ctx, c, b, check, list, uploadBackground } = env;
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
  return warm;
}
