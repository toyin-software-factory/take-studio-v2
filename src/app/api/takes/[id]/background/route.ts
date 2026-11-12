import { handleChangeBackground } from "@/server/backgrounds/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** Change the take's background: a free re render that keeps the take Ready (spec 0008). */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  return handleChangeBackground(request, (await params).id, takeHttpDeps());
}
