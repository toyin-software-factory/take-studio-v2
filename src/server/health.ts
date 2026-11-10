import { sql } from "drizzle-orm";
import { createR2 } from "@/lib/r2";
import { parseWebEnv } from "@/lib/env";
import { getDb } from "./request";

export type CheckResult = "ok" | "error";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: { database: CheckResult; storage: CheckResult };
}

async function check(fn: () => Promise<boolean | void>): Promise<CheckResult> {
  try {
    const result = await fn();
    return result === false ? "error" : "ok";
  } catch {
    // IDs only in logs: the error itself may carry connection details.
    return "error";
  }
}

/** Database through Hyperdrive, and the R2 bucket over the S3 API. */
export async function runHealthChecks(): Promise<HealthReport> {
  const [database, storage] = await Promise.all([
    check(async () => {
      const db = await getDb();
      await db.execute(sql`select 1`);
    }),
    check(async () => createR2(parseWebEnv()).isReachable()),
  ]);
  return {
    status: database === "ok" && storage === "ok" ? "ok" : "degraded",
    checks: { database, storage },
  };
}
