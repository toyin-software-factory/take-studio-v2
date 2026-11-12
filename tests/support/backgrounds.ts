import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./session";

/**
 * Test only: seeds background rows (built in or a creator's own) and sets a creator's last pick,
 * straight into the local or CI Postgres (same guard as `session.ts`). Own rows go with the user;
 * built in rows are removed by `removeBackgrounds`.
 */

export type BackgroundSeed = {
  readonly name: string;
  readonly creatorId?: string;
  readonly status?: string;
  readonly minutesAgo?: number;
};

export async function seedBackgrounds(seeds: readonly BackgroundSeed[]): Promise<string[]> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const ids: string[] = [];
  try {
    for (const seed of seeds) {
      const id = randomUUID();
      ids.push(id);
      const ready = (seed.status ?? "ready") === "ready";
      const created = new Date(Date.now() - (seed.minutesAgo ?? 0) * 60_000);
      await sql`insert into background (id, creator_id, name, status, alt, image_key, thumb_key, width, height, created_at, updated_at)
                values (${id}, ${seed.creatorId ?? null}, ${seed.name}, ${seed.status ?? "ready"},
                  ${seed.creatorId ? null : `${seed.name}, a studio background`},
                  ${ready ? `backgrounds/test/${id}.jpg` : null}, ${ready ? `backgrounds/test/${id}.webp` : null},
                  ${ready ? 1920 : null}, ${ready ? 1080 : null}, ${created}, ${created})`;
    }
  } finally {
    await sql.end();
  }
  return ids;
}

export async function setDefaultBackground(creatorId: string, backgroundId: string | null) {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  try {
    await sql`update "user" set default_background_id = ${backgroundId} where id = ${creatorId}`;
  } finally {
    await sql.end();
  }
}

export async function removeBackgrounds(ids: readonly string[]) {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  try {
    await sql`delete from background where id in ${sql(ids as string[])}`;
  } finally {
    await sql.end();
  }
}
