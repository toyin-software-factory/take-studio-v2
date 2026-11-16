import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import type { BrowserContext } from "@playwright/test";
import { usageAccountHash } from "../../src/lib/usage-hash";
import { localDatabaseUrl, USAGE_TEST_HASH_SECRET } from "./session";

/**
 * Test only (spec 0023 e2e): seeds a guest, its claim row and a take straight in the local or CI
 * Postgres (same guard as `session.ts`), so the claim page and the cleanup can be driven without
 * the browser upload. Synthetic data only; the returned cleanup removes everything it made.
 */

export const GUEST_COOKIE = "ts_guest";
/** Cloudflare's documented Turnstile test token: accepted by the always pass test secret. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export type GuestSeed = {
  readonly email?: string | null;
  readonly takeStatus?: "uploading" | "uploaded" | "ready";
  readonly durationMs?: number;
  /** Hours until the claim expires; negative for the past. */
  readonly expiresInHours?: number;
};

export type SeededGuest = {
  readonly guestUserId: string;
  readonly claimId: string;
  readonly takeId: string;
  readonly token: string;
  readonly cleanup: () => Promise<void>;
};

export async function seedGuest(seed: GuestSeed = {}): Promise<SeededGuest> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const guestUserId = randomUUID();
  const claimId = randomUUID();
  const takeId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const email = seed.email?.toLowerCase() ?? null;
  const emailHash = email ? await usageAccountHash(email, USAGE_TEST_HASH_SECRET) : null;
  const status = seed.takeStatus ?? "uploaded";
  const now = new Date();
  const expires = new Date(now.getTime() + (seed.expiresInHours ?? 24) * 3_600_000);
  await sql`insert into "user" (id, name, email, email_verified, guest, created_at, updated_at)
            values (${guestUserId}, 'Guest', ${`guest-${guestUserId}@guest.invalid`}, false, true, ${now}, ${now})`;
  await sql`insert into guest_claim (id, guest_user_id, token_hash, email, email_hash, ip_hash, expires_at)
            values (${claimId}, ${guestUserId}, ${createHash("sha256").update(token).digest("hex")},
              ${email}, ${emailHash}, ${`e2e-${randomUUID()}`}, ${expires})`;
  await sql`insert into take (id, creator_id, title, status, original_key, original_bytes, container,
              duration_ms, width, height, guest_origin, video_expires_at, created_at, updated_at)
            values (${takeId}, ${guestUserId}, 'Guest drop', ${status}, ${`originals/${takeId}/source.mp4`},
              30754, 'mp4', ${seed.durationMs ?? 60_000}, 320, 180, true,
              ${new Date(now.getTime() + 30 * 86_400_000)}, ${now}, ${now})`;
  return {
    guestUserId,
    claimId,
    takeId,
    token,
    cleanup: async () => {
      await sql`delete from take where id = ${takeId}`;
      await sql`delete from "user" where id = ${guestUserId}`;
      await sql.end();
    },
  };
}

export async function setGuestCookie(
  context: BrowserContext,
  baseURL: string,
  token: string,
): Promise<void> {
  await context.addCookies([
    { name: GUEST_COOKIE, value: token, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);
}

/** One query for specs that check where a take lives or what a claim left behind. */
export async function query<T extends postgres.Row>(
  run: (sql: postgres.Sql) => Promise<T[]>,
): Promise<T[]> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** Sets or clears the two drop box settings; returns the restore function. */
export async function setGuestSettings(state: {
  readonly enabled?: boolean;
  readonly dailyMinutes?: number;
}): Promise<() => Promise<void>> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const keys = ["guest_upload_enabled", "guest_daily_minutes"];
  const before = await sql<{ key: string; value: unknown }[]>`
    select key, value from app_setting where key = any(${keys})`;
  const put = async (key: string, value: unknown) => {
    await sql`insert into app_setting (key, value) values (${key}, ${sql.json(value as never)})
              on conflict (key) do update set value = excluded.value`;
  };
  if (state.enabled !== undefined) await put(keys[0]!, state.enabled);
  if (state.dailyMinutes !== undefined) await put(keys[1]!, state.dailyMinutes);
  return async () => {
    await sql`delete from app_setting where key = any(${keys})`;
    for (const row of before) await put(row.key, row.value);
    await sql.end();
  };
}
