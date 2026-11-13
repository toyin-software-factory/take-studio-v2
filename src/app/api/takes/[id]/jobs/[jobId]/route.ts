import { handleJobStatus } from "@/server/changes/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = {
  readonly params: Promise<{ readonly id: string; readonly jobId: string }>;
};

/** The status of one job of this take, polled by the page that started it (spec 0011). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { id, jobId } = await params;
  return handleJobStatus(request, id, jobId, takeHttpDeps());
}
