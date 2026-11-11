import { handleParts } from "@/server/uploads/http";
import { uploadHttpDeps } from "@/server/uploads/deps";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ takeId: string }> };

/** Presigned part upload links, 15 minutes (spec 0004). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleParts(request, (await params).takeId, uploadHttpDeps());
}
