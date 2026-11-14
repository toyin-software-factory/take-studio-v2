import { handleRevoke } from "@/server/api-keys/http";
import { apiKeyHttpDeps } from "@/server/api-keys/deps";

export const dynamic = "force-dynamic";

/** Revokes one key by deleting it (spec 0018 AC-3). Session only. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleRevoke(request, id, apiKeyHttpDeps());
}
