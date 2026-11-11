import { parseEmailEnv } from "@/lib/env";
import { turnOffTakeEmails } from "@/server/email/turn-off";
import { getDb } from "@/server/request";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<"off" | "invalid"> {
  const params = new URL(request.url).searchParams;
  const env = parseEmailEnv();
  return turnOffTakeEmails(
    await getDb(),
    { userId: params.get("u"), signature: params.get("s") },
    env.EMAIL_LINK_SECRET,
  );
}

/** The link in the email: turns take emails off, then shows a confirmation page. */
export async function GET(request: Request): Promise<Response> {
  const result = await handle(request).catch(() => "invalid" as const);
  const target = new URL("/emails/off/done", request.url);
  target.searchParams.set("status", result);
  return Response.redirect(target, 303);
}

/** One click unsubscribe from the mail client itself (RFC 8058): no page, just a status. */
export async function POST(request: Request): Promise<Response> {
  const result = await handle(request).catch(() => "invalid" as const);
  return new Response(null, { status: result === "off" ? 200 : 400 });
}
