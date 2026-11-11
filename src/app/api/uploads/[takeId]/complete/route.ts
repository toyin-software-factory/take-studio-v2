import { handleComplete } from "@/server/uploads/http";
import { uploadHttpDeps } from "@/server/uploads/deps";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ takeId: string }> };

/** Completes the upload, checks its size and starts the probe (spec 0004). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleComplete(request, (await params).takeId, uploadHttpDeps());
}
