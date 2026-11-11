/**
 * Applies r2-cors.json to the R2 bucket with the Cloudflare API (spec 0004, Security model),
 * then reads it back. Needs CLOUDFLARE_API_TOKEN (R2 edit), CLOUDFLARE_ACCOUNT_ID, R2_BUCKET.
 * Usage: pnpm r2:cors   (pnpm r2:cors --check only reads the current rules)
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

const env = z
  .object({
    CLOUDFLARE_API_TOKEN: z.string().min(1),
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
    R2_BUCKET: z.string().min(1),
  })
  .parse(process.env);

const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${env.R2_BUCKET}/cors`;
const headers = {
  authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
  "content-type": "application/json",
};

async function call(method: "GET" | "PUT", body?: string): Promise<unknown> {
  const res = await fetch(url, { method, headers, body });
  if (method === "GET" && res.status === 404) return "No CORS configuration on this bucket yet.";
  const json = (await res.json()) as { success?: boolean; errors?: unknown; result?: unknown };
  if (!res.ok || json.success === false) {
    throw new Error(
      `Cloudflare API ${method} failed: HTTP ${res.status} ${JSON.stringify(json.errors)}`,
    );
  }
  return json.result;
}

if (!process.argv.includes("--check")) {
  const rules = readFileSync(new URL("../r2-cors.json", import.meta.url), "utf8");
  await call("PUT", rules);
  console.log(`Applied r2-cors.json to bucket ${env.R2_BUCKET}.`);
}
console.log(JSON.stringify(await call("GET"), null, 2));
