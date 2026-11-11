import { handleAbort } from "@/server/uploads/http";
import { uploadHttpDeps } from "@/server/uploads/deps";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ takeId: string }> };

/** Cancels an upload in progress (spec 0004). */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return handleAbort(request, (await params).takeId, uploadHttpDeps());
}
