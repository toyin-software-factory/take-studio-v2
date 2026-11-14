/**
 * Applies the R2 lifecycle rules (`lifecycleRules()`, spec 0013 AC-9) to the bucket with the
 * Cloudflare API, then reads them back. PUT replaces the whole rule set, so running it twice
 * gives the same result. Needs R2_LIFECYCLE_TOKEN, CLOUDFLARE_ACCOUNT_ID, R2_BUCKET.
 * Usage: bash scripts/apply-r2-lifecycle.sh   (it skips with a warning when the token is unset)
 */
import { z } from "zod";
import { BACKSTOP_DAYS, lifecycleRules } from "../src/lib/storage-lifecycle";

const env = z
  .object({
    R2_LIFECYCLE_TOKEN: z.string().min(1),
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
    R2_BUCKET: z.string().min(1),
  })
  .parse(process.env);

const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${env.R2_BUCKET}/lifecycle`;
const headers = {
  authorization: `Bearer ${env.R2_LIFECYCLE_TOKEN}`,
  "content-type": "application/json",
};
const envelope = z.object({
  success: z.boolean().optional(),
  errors: z.unknown().optional(),
  result: z.unknown().optional(),
});

async function call(method: "GET" | "PUT", body?: string): Promise<unknown> {
  const res = await fetch(url, { method, headers, body });
  const parsed = envelope.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success || parsed.data.success === false) {
    const errors = parsed.success ? JSON.stringify(parsed.data.errors) : "(no JSON body)";
    throw new Error(`Cloudflare API ${method} failed: HTTP ${res.status} ${errors}`);
  }
  return parsed.data.result;
}

await call("PUT", JSON.stringify(lifecycleRules()));
const applied = z
  .object({ rules: z.array(z.object({ id: z.string() }).passthrough()) })
  .parse(await call("GET"));
console.log(
  `Applied ${applied.rules.length} lifecycle rules (${BACKSTOP_DAYS} days) to bucket ${env.R2_BUCKET}: ${applied.rules.map((r) => r.id).join(", ")}`,
);
