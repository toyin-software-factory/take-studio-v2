import { transcriptHttpDeps } from "@/server/takes/deps";
import { handleTranscriptDownload } from "@/server/transcripts/http";

export const dynamic = "force-dynamic";

type Context = {
  readonly params: Promise<{ readonly id: string; readonly format: string }>;
};

/** The transcript as a text, SRT or WebVTT file on the trimmed timeline (spec 0007, AC-4). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { id, format } = await params;
  return handleTranscriptDownload(request, id, format, transcriptHttpDeps());
}
