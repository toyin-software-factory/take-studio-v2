import { sql } from "drizzle-orm";
import { createR2 } from "@/lib/r2";
import { parseWebEnv } from "@/lib/env";
import { getDb } from "./request";

export type CheckResult = "ok" | "error";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: { database: CheckResult; storage: CheckResult };
}

/** Each check must settle within this, so a stalled connection can't hold up the report. */
const CHECK_DEADLINE_MS = 5_000;

class CheckTimeoutError extends Error {
  override name = "CheckTimeoutError";
}

/** Resolves or rejects with `promise`, or rejects with CheckTimeoutError after `ms`. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeoutError()), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one health check and turns any failure or timeout into "error", logging only its name and error class. */
async function check(name: string, fn: () => Promise<boolean | void>): Promise<CheckResult> {
  try {
    const result = await withDeadline(fn(), CHECK_DEADLINE_MS);
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
