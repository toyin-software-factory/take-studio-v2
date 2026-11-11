import { handleGet, handleRename } from "@/server/takes/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** One take with its latest job, render and removed time; polled by the take page (AC-8). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleGet(request, (await params).id, takeHttpDeps());
}

/** Rename the take (AC-9). */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  return handleRename(request, (await params).id, takeHttpDeps());
}
