import { handleCreate, handleList } from "@/server/api-keys/http";
import { apiKeyHttpDeps } from "@/server/api-keys/deps";

export const dynamic = "force-dynamic";

/** The creator's API keys, newest first (spec 0018 AC-3). Session only. */
export function GET(request: Request): Promise<Response> {
  return handleList(request, apiKeyHttpDeps());
}

/** Makes a key; the key is in this answer only (spec 0018 AC-1). Session only. */
export function POST(request: Request): Promise<Response> {
  return handleCreate(request, apiKeyHttpDeps());
}
