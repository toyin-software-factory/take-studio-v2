import { handleDisconnect } from "@/server/oauth/http";
import { connectedAppsDeps } from "@/server/oauth/deps";

export const dynamic = "force-dynamic";

/** Disconnects one app: deletes its consent and the creator's tokens for it. Session only. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleDisconnect(request, id, connectedAppsDeps());
}
