import { getAuth } from "@/server/request";

/** Hands every /api/auth/* request to a per request Better Auth instance. */
async function handle(request: Request): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(request);
}

export { handle as GET, handle as POST };
