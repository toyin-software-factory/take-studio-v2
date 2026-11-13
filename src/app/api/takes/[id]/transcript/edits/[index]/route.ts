import { transcriptHttpDeps } from "@/server/takes/deps";
import { handlePatchEdit } from "@/server/transcripts/http";

export const dynamic = "force-dynamic";

type Context = {
  readonly params: Promise<{ readonly id: string; readonly index: string }>;
};

/** Undo or redo one AI transcript fix (spec 0012, AC-4, AC-11). */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const { id, index } = await params;
  return handlePatchEdit(request, id, index, transcriptHttpDeps());
}
