import { uploadHttpDeps } from "@/server/backgrounds/upload-deps";
import { handleCompleteBackground } from "@/server/backgrounds/upload-http";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** The browser finished sending the image: start ingest (spec 0008, AC-8). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleCompleteBackground(request, (await params).id, uploadHttpDeps());
}
