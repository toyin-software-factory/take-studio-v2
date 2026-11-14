import { z } from "zod";
import { type ApiAuthDeps, guard as authGuard } from "../api-auth";
import { createApiKey, listApiKeys, revokeApiKey } from "@/db/data/api-keys";
import { apiKeyPrefix, generateApiKey, hashApiKey, normalizeKeyName } from "@/lib/api-rules";

/**
 * HTTP handlers for the API key routes (spec 0018 AC-1, AC-3, AC-4, AC-13). Session only: any
 * request carrying an `Authorization` header is 401 `session_required` before anything else is
 * read, so a leaked key can never make, list or revoke keys. Order: Origin (writes), bearer,
 * session, then the work. Every answer is `Cache-Control: private, no-store`. Nothing here logs.
 * The raw key exists in `handleCreate` only, and only the 201 body carries it.
 */

export type ApiKeyHttpDeps = Pick<ApiAuthDeps, "getCreator" | "allowedOrigin">;

export type ApiKeyError = "unauthorized" | "not_found" | "invalid" | "key_limit";

const STATUS: Readonly<Record<ApiKeyError, number>> = {
  unauthorized: 401,
  not_found: 404,
  invalid: 422,
  key_limit: 409,
};

const MESSAGES: Readonly<Record<ApiKeyError, string>> = {
  unauthorized: "Please sign in again.",
  not_found: "We couldn't find that key.",
  invalid: "Enter a name between 1 and 60 characters.",
  key_limit: "You already have 5 keys. Revoke one to make another.",
};

const PRIVATE_NO_STORE = { "cache-control": "private, no-store" } as const;

const json = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: PRIVATE_NO_STORE });

const errorResponse = (code: ApiKeyError): Response =>
  json({ error: code, message: MESSAGES[code] }, STATUS[code]);

const guard = (
  request: Request,
  deps: ApiKeyHttpDeps,
  options: { readonly checkOrigin: boolean },
) => authGuard(request, deps, { ...options, sessionOnly: true });

const bodySchema = z.object({ name: z.string() }).strict();

/** A valid body is a key name of at most 60 characters in JSON, so 4 KB is far above it. */
const MAX_BODY_BYTES = 4 * 1024;

/** The JSON body read with a byte limit; null when it is too big or not JSON. */
async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** POST /api/keys `{ name }`: 201 `{ id, name, prefix, key, createdAt }`, the key shown once. */
export async function handleCreate(request: Request, deps: ApiKeyHttpDeps): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const body = bodySchema.safeParse(await readJsonBody(request));
  const name = body.success ? normalizeKeyName(body.data.name) : null;
  if (name === null) return errorResponse("invalid");

  const key = generateApiKey();
  const created = await createApiKey(creator.db, {
    creatorId: creator.creatorId,
    name,
    prefix: apiKeyPrefix(key),
    keyHash: await hashApiKey(key),
  });
  if (!created.ok)
    return errorResponse(created.error === "key_limit" ? "key_limit" : "unauthorized");
  const { id, prefix, createdAt } = created.data;
  return json({ id, name, prefix, key, createdAt }, 201);
}

/** GET /api/keys: the creator's keys, newest first, nothing secret. */
export async function handleList(request: Request, deps: ApiKeyHttpDeps): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: false });
  if (creator instanceof Response) return creator;
  const keys = await listApiKeys(creator.db, creator.creatorId);
  return json({ keys }, 200);
}

/** DELETE /api/keys/{id}: 204; another creator's, a malformed, a missing ID or a repeat is 404. */
export async function handleRevoke(
  request: Request,
  keyId: string,
  deps: ApiKeyHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const removed = await revokeApiKey(creator.db, creator.creatorId, keyId);
  if (!removed.ok) return errorResponse("not_found");
  return new Response(null, { status: 204, headers: PRIVATE_NO_STORE });
}
