import { readFile } from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import * as schema from "@/db/schema";
import { builtInKeys, studiosToInstall } from "@/lib/built-in-backgrounds";
import type { R2 } from "@/lib/r2";

/** Where the studio images are, relative to the working directory (the project root; in a
 *  Trigger.dev deploy the `additionalFiles` extension keeps the same relative path). */
const ASSETS_DIR = path.join("assets", "backgrounds");

const readAsset = (name: string): Promise<Uint8Array<ArrayBuffer>> =>
  readFile(path.join(process.cwd(), ASSETS_DIR, name)).then(
    (b) => new Uint8Array(b) as Uint8Array<ArrayBuffer>,
  );

/**
 * Installs the built in studio backgrounds (spec 0008, AC-7): uploads each image and thumbnail
 * and upserts its `background` row with its fixed ID, so running it again changes nothing.
 * The `cleanup` task calls it every 15 minutes with `local: false` (Trigger.dev already holds
 * the R2 keys and the production database, so no new secrets), and `pnpm db:seed` and the
 * pipeline test call it with `local: true` against a local database. A `testOnly` studio (the
 * placeholder) is installed only when `local` is true: production never gets a test background.
 *
 * Cheap when everything is there: one query for the rows, no upload for a studio whose row is
 * already ready with the same name, alt text, keys and size (a changed image or text is a new
 * row value, so the change is picked up). Never logs a key. Returns the studios it wrote.
 */
export async function ensureBuiltInBackgrounds(
  db: Db,
  r2: Pick<R2, "putObject">,
  options: {
    readonly local: boolean;
    readonly log?: (line: string) => void;
    readonly read?: (name: string) => Promise<Uint8Array<ArrayBuffer>>;
  },
): Promise<number> {
  const log = options.log ?? (() => undefined);
  const read = options.read ?? readAsset;
  const studios = studiosToInstall(options.local);
  if (studios.length === 0) {
    log("  no studios to install here yet");
    return 0;
  }
  const existing = await db
    .select()
    .from(schema.background)
    .where(
      inArray(
        schema.background.id,
        studios.map((b) => b.id),
      ),
    );
  const byId = new Map(existing.map((row) => [row.id, row]));
  let written = 0;
  for (const b of studios) {
    const keys = builtInKeys(b.slug);
    const values = {
      creatorId: null,
      name: b.name,
      sourceKey: null,
      imageKey: keys.imageKey,
      thumbKey: keys.thumbKey,
      width: b.width,
      height: b.height,
      status: "ready",
      failureCode: null,
      alt: b.alt,
    };
    const row = byId.get(b.id);
    const current =
      row !== undefined &&
      row.creatorId === null &&
      row.name === values.name &&
      row.imageKey === values.imageKey &&
      row.thumbKey === values.thumbKey &&
      row.width === values.width &&
      row.height === values.height &&
      row.status === "ready" &&
      row.failureCode === null &&
      row.alt === values.alt;
    if (current) continue;
    await r2.putObject(keys.imageKey, await read(`${b.slug}.jpg`), "image/jpeg");
    await r2.putObject(keys.thumbKey, await read(`${b.slug}.webp`), "image/webp");
    const set = { ...values, updatedAt: new Date() };
    await db
      .insert(schema.background)
      .values({ id: b.id, ...set })
      .onConflictDoUpdate({ target: schema.background.id, set });
    log(`  ${b.slug}: installed`);
    written++;
  }
  return written;
}
