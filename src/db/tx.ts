import type { Result } from "@/lib/result";
import type { Executor, Tx } from "./types";

/** Carries a failed result out of a transaction so the transaction rolls back. */
class RollbackWith extends Error {
  constructor(readonly result: { readonly ok: false; readonly error: string }) {
    super(`rolled back: ${result.error}`);
  }
}

/**
 * Lock order rule: creator, then background, then take, then job, then the rows under them. Read it in
 * src/db/AGENTS.md before locking two kinds of row in one transaction; the stress test
 * src/server/lock-order.test.ts fails on a deadlock.
 *
 * Runs `fn` in one transaction (a savepoint when `db` is already a transaction).
 * An `{ ok: false }` result rolls everything back and is returned as is; thrown errors
 * roll back and propagate.
 */
export async function runTx<T, E extends string>(
  db: Executor,
  fn: (tx: Tx) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  try {
    return await db.transaction(async (tx) => {
      const result = await fn(tx);
      if (!result.ok) throw new RollbackWith(result);
      return result;
    });
  } catch (error) {
    if (error instanceof RollbackWith) return error.result as Result<T, E>;
    throw error;
  }
}
