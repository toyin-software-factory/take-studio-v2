import type { Db } from "@/db/types";
import { usageForCreator, usageNumbers, PRIVATE_NO_STORE } from ".";

/**
 * GET /api/usage (spec 0014 AC-8): the signed in creator's numbers for this UTC month.
 * Session required (401), never the email or hash, `Cache-Control: private, no-store`.
 */
export type UsageHttpDeps = {
  readonly getCreator: (
    request: Request,
  ) => Promise<{ readonly db: Db; readonly creatorId: string } | null>;
  readonly usageSecret: () => string;
  readonly now?: () => Date;
};

const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: PRIVATE_NO_STORE });

export async function handleUsage(request: Request, deps: UsageHttpDeps): Promise<Response> {
  const creator = await deps.getCreator(request);
  if (!creator) return reply({ error: "unauthorized", message: "Please sign in again." }, 401);
  let secret: string;
  try {
    secret = deps.usageSecret();
  } catch {
    return reply(
      { error: "unavailable", message: "Usage isn't available right now. Please try again later." },
      503,
    );
  }
  const usage = await usageForCreator(creator.db, {
    creatorId: creator.creatorId,
    usageSecret: secret,
    now: deps.now?.() ?? new Date(),
  });
  if (!usage.ok) return reply({ error: "unauthorized", message: "Please sign in again." }, 401);
  return reply(usageNumbers(usage.data), 200);
}
