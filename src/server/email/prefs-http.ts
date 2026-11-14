import { z } from "zod";
import { getTakeEmails, setTakeEmails } from "@/db/data/email-prefs";
import { errorResponse, guard, json, type TakeHttpDeps } from "../takes/http";

type Deps = Pick<TakeHttpDeps, "getCreator" | "allowedOrigin" | "keyAuth">;

const bodySchema = z.object({ takeEmails: z.boolean() });

/** GET /api/account/email-prefs: whether take emails are on for the signed in creator. */
export async function handleGetPrefs(request: Request, deps: Deps): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const takeEmails = await getTakeEmails(creator.db, creator.creatorId);
  return takeEmails === null ? errorResponse("unauthorized") : json({ takeEmails });
}

/** PATCH /api/account/email-prefs { takeEmails }: turn take emails on or off (AC-6). */
export async function handleSetPrefs(request: Request, deps: Deps): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse("invalid");
  const done = await setTakeEmails(creator.db, creator.creatorId, body.data.takeEmails);
  return done ? json({ takeEmails: body.data.takeEmails }) : errorResponse("unauthorized");
}
