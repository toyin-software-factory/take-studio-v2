import { handleGetTranscript } from "@/server/transcripts/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** The take's transcript state and paragraphs (spec 0007). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleGetTranscript(request, (await params).id, takeHttpDeps());
}
