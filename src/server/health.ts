import { sql } from "drizzle-orm";
import { createR2 } from "@/lib/r2";
import { parseWebEnv } from "@/lib/env";
import { getDb } from "./request";

export type CheckResult = "ok" | "error";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: { database: CheckResult; storage: CheckResult };
}

async function check(name: string, fn: () => Promise<boolean | void>): Promise<CheckResult> {
  try {
    const result = await fn();
    if (result === false) {
      console.error("health check failed", { check: name, reason: "unreachable" });
      return "error";
    }
    return "ok";
  } catch (error) {
    // Log the check name and error class only: the message may carry connection details.
    console.error("health check failed", {
      check: name,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return "error";
  }
}

/** Database through Hyperdrive, and the R2 bucket over the S3 API. */
export async function runHealthChecks(): Promise<HealthReport> {
  const [database, storage] = await Promise.all([
    check("database", async () => {
      const db = await getDb();
      await db.execute(sql`select 1`);
    }),
    check("storage", async () => createR2(parseWebEnv()).isReachable()),
  ]);
  return {
    status: database === "ok" && storage === "ok" ? "ok" : "degraded",
    checks: { database, storage },
  };
}
