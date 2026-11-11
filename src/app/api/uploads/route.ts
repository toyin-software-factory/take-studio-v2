import { handleCreate } from "@/server/uploads/http";
import { uploadHttpDeps } from "@/server/uploads/deps";

export const dynamic = "force-dynamic";

/** Starts a browser upload: creates the take and the R2 multipart upload (spec 0004). */
export function POST(request: Request): Promise<Response> {
  return handleCreate(request, uploadHttpDeps());
}
