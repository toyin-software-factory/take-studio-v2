import { eq } from "drizzle-orm";
import { user } from "@/db/schema";
import type { Executor } from "@/db/types";

/** The creator's "email me when takes are ready" setting (spec 0006, AC-6). */
export async function getTakeEmails(db: Executor, userId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ takeEmails: user.takeEmails })
    .from(user)
    .where(eq(user.id, userId));
  return row ? row.takeEmails : null;
}

/** Turns take emails on or off; false when the user doesn't exist. */
export async function setTakeEmails(db: Executor, userId: string, on: boolean): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({ takeEmails: on })
    .where(eq(user.id, userId))
    .returning({ id: user.id });
  return rows.length > 0;
}
