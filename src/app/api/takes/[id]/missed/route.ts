import { handleMissed } from "@/server/takes/missed";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** "Missed something?" mark at the playhead (spec 0017 AC-4): a time only, changes no cut. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleMissed(request, (await params).id, takeHttpDeps());
}
