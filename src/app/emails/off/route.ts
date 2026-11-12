import { emailEnvSchema } from "@/lib/env";
import { turnOffTakeEmails } from "@/server/email/turn-off";
import { getDb } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * The link in the email. A GET changes nothing: mail scanners and link previews fetch URLs
 * in messages and headers, so it only sends the browser to a confirmation page that keeps
 * the signed parameters. The change happens on POST (spec 0006, AC-6; RFC 8058).
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const target = new URL("/emails/off/confirm", request.url);
  for (const name of ["u", "s"]) {
    const value = params.get(name);
    if (value) target.searchParams.set(name, value);
  }
  return Response.redirect(target, 303);
}

/**
 * Turns take emails off. Two callers: the mail client's one click button (RFC 8058, plain
 * 200 or 400, no page) and the confirmation page form (`from=page`, redirected to the result).
 */
export async function POST(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const fromPage = (await request.formData().catch(() => null))?.get("from") === "page";
  const result = await turnOff(params);
  if (!fromPage) return new Response(null, { status: result === "off" ? 200 : 400 });
  const target = new URL("/emails/off/done", request.url);
  target.searchParams.set("status", result);
  return Response.redirect(target, 303);
}

/**
 * Everything that can fail sits behind one guard: a missing email setting (checked with
 * `safeParse`, so nothing throws), no database or a rejected change all answer "invalid" (400 for the
 * one click, the invalid page for the form), never a 500. Logs name the missing variables only.
 */
async function turnOff(params: URLSearchParams): Promise<"off" | "invalid"> {
  const env = emailEnvSchema.safeParse(process.env);
  if (!env.success) {
    const names = [...new Set(env.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    console.error(`emails/off: email env missing or invalid: ${names}`);
    return "invalid";
  }
  try {
    return await turnOffTakeEmails(
      await getDb(),
      { userId: params.get("u"), signature: params.get("s") },
      env.data.EMAIL_LINK_SECRET,
    );
  } catch {
    return "invalid";
  }
}
