import { transcriptHttpDeps } from "@/server/takes/deps";
import { handleGetTranscript, handleMakeTranscript } from "@/server/transcripts/http";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** The take's transcript state and paragraphs (spec 0007). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleGetTranscript(request, (await params).id, transcriptHttpDeps());
}

/** Make transcript / Try again: starts a transcribe job for the take (spec 0007, AC-9). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleMakeTranscript(request, (await params).id, transcriptHttpDeps());
}
