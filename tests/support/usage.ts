import postgres from "postgres";
import { usageAccountHash } from "../../src/lib/usage-hash";
import { localDatabaseUrl, setting, type TestUser } from "./session";

/**
 * Test only: sets the monthly usage state of a test user in the local or CI Postgres (same
 * guard as `session.ts`): the two `app_setting` rows and this month's `usage_month` row. The
 * hash uses the same `USAGE_HASH_SECRET` the Worker was built with. The returned cleanup puts
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
  const secret = setting("USAGE_HASH_SECRET");
  if (!secret) throw new Error("USAGE_HASH_SECRET is not set (CI writes it to .env).");
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const hash = await usageAccountHash(user.email, secret);
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const keys = ["usage_limit_enabled", "free_monthly_seconds"];
  const before = await sql<{ key: string; value: unknown }[]>`
    select key, value from app_setting where key in ${sql(keys)}`;
  const put = async (key: string, value: unknown) => {
    await sql`insert into app_setting (key, value) values (${key}, ${sql.json(value as never)})
              on conflict (key) do update set value = excluded.value`;
  };
  await put("usage_limit_enabled", state.enforced);
  await put("free_monthly_seconds", state.allowanceSeconds ?? 3600);
  await sql`insert into usage_month (account_hash, month, seconds_used)
            values (${hash}, ${month}, ${state.usedSeconds})
            on conflict (account_hash, month) do update set seconds_used = excluded.seconds_used`;
  return async () => {
    await sql`delete from usage_month where account_hash = ${hash}`;
    for (const key of keys) {
      const old = before.find((row) => row.key === key);
      if (old) await put(key, old.value);
      else await sql`delete from app_setting where key = ${key}`;
    }
    await sql.end();
  };
}
