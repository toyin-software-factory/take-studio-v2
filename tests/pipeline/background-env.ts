/** What the background scenarios share (spec 0008): the run context, types, helpers and the studio. */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { BUILT_IN_BACKGROUNDS } from "@/lib/built-in-backgrounds";
import * as schema from "../../src/db/schema";
import { db } from "./harness";
import { type Creator } from "./creator";
import { until } from "./wait";

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

export type Item = { id: string; name: string; status: string; thumbUrl: string | null };
export type List = { builtIn: Item[]; mine: Item[]; defaultId: string | null };
export type TakeJson = {
  take: { status: string };
  background: { id: string | null; name: string; keyed: boolean } | null;
  noGreenScreen: boolean;
  backgroundJob: { status: string; failureCode: string | null } | null;
};

/** The blue, test only studio: the checks look for blue where the green was (the six real studios are not blue). */

export const PLACEHOLDER = BUILT_IN_BACKGROUNDS.find((b) => b.testOnly)!;
export const STUDIO = PLACEHOLDER;
export const S = "background";

/** The helpers every section uses, built from the run context. */
export function makeEnv(ctx: Ctx) {
  const { c, b, check } = ctx;
  const list = async (who: Creator = c) =>
    (await who.api("GET", "/api/backgrounds")).json as unknown as List;
  const takeOf = async (id: string) =>
    (await c.api("GET", `/api/takes/${id}`)).json as unknown as TakeJson;
  const jobsOf = (takeId: string) =>
    db.select().from(schema.processingJob).where(eq(schema.processingJob.takeId, takeId));
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
  return { ctx, c, b, check, list, takeOf, jobsOf, charged, uploadBackground };
}

export type Env = ReturnType<typeof makeEnv>;
