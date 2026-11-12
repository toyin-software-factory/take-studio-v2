import { previewHttpDeps } from "@/server/backgrounds/preview-deps";
import { handleGetPreview, handlePostPreview } from "@/server/backgrounds/preview-http";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** Start (or reuse) the still of a take on a background (spec 0008, AC-4). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handlePostPreview(request, (await params).id, previewHttpDeps());
}

/** Read that still: its state and, when ready, a link. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleGetPreview(request, (await params).id, previewHttpDeps());
}
