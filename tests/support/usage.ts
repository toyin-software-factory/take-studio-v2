import postgres from "postgres";
import { usageAccountHash } from "../../src/lib/usage-hash";
import { localDatabaseUrl, USAGE_TEST_HASH_SECRET, type TestUser } from "./session";

/** Arbitrary key shared by every `setUsage` caller. */
const USAGE_LOCK = 2100021;

/**
 * Test only: sets the monthly usage state of a test user in the local or CI Postgres (same
 * guard as `session.ts`): the two `app_setting` rows and this month's `usage_month` row. The
 * hash uses the made up `USAGE_TEST_HASH_SECRET`, which CI writes to `.env` and the local build script bakes in. The returned cleanup puts
 * the settings back as they were and removes the usage row.
 */
export async function setUsage(
  user: TestUser,
  state: {
    readonly usedSeconds: number;
    readonly enforced: boolean;
    readonly allowanceSeconds?: number;
  },
): Promise<() => Promise<void>> {
  const secret = USAGE_TEST_HASH_SECRET;
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const keys = ["usage_limit_enabled", "free_monthly_seconds"];
  let hash: string | null = null;
  let before: { key: string; value: unknown }[] = [];
  let locked = false;
  let snapshotted = false;
  const put = async (key: string, value: unknown) => {
    await sql`insert into app_setting (key, value) values (${key}, ${sql.json(value as never)})
              on conflict (key) do update set value = excluded.value`;
  };
  const restore = async () => {
    try {
      // Nothing was written before the snapshot, so there is nothing to put back.
      if (snapshotted) {
        if (hash) await sql`delete from usage_month where account_hash = ${hash}`;
        for (const key of keys) {
          const old = before.find((row) => row.key === key);
          if (old) await put(key, old.value);
          else await sql`delete from app_setting where key = ${key}`;
        }
      }
    } finally {
      try {
        if (locked) await sql`select pg_advisory_unlock(${USAGE_LOCK})`;
      } finally {
        await sql.end();
      }
    }
  };
  try {
    // The playwright projects already run the usage files one at a time; this lock is the
    // backstop if one is ever run another way. Held until the cleanup runs.
    await sql`select pg_advisory_lock(${USAGE_LOCK})`;
    locked = true;
    hash = await usageAccountHash(user.email, secret);
    const month = `${new Date().toISOString().slice(0, 7)}-01`;
    before = await sql<{ key: string; value: unknown }[]>`
      select key, value from app_setting where key in ${sql(keys)}`;
    snapshotted = true;
    await put("usage_limit_enabled", state.enforced);
    await put("free_monthly_seconds", state.allowanceSeconds ?? 3600);
    await sql`insert into usage_month (account_hash, month, seconds_used)
              values (${hash}, ${month}, ${state.usedSeconds})
              on conflict (account_hash, month) do update set seconds_used = excluded.seconds_used`;
  } catch (error) {
    await restore().catch(() => undefined);
    throw error;
  }
  return restore;
}
