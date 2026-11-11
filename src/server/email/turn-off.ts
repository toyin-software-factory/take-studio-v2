import { setTakeEmails } from "@/db/data/email-prefs";
import type { Executor } from "@/db/types";
import { verifyUnsubscribe } from "@/lib/email-links";

export type TurnOffResult = "off" | "invalid";

/**
 * The signed "Turn off these emails" link (spec 0006, AC-6): no sign in, and the signature
 * can do nothing but switch take emails off for that user. A bad signature and an unknown
 * user look the same, so the link reveals nothing about accounts.
 */
export async function turnOffTakeEmails(
  db: Executor,
  params: { readonly userId: string | null; readonly signature: string | null },
  secret: string,
): Promise<TurnOffResult> {
  const { userId, signature } = params;
  if (!userId || !signature) return "invalid";
  if (!(await verifyUnsubscribe(userId, signature, secret))) return "invalid";
  return (await setTakeEmails(db, userId, false)) ? "off" : "invalid";
}
