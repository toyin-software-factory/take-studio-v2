import { handleChanges } from "@/server/changes/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** Render cut changes and a background choice together: one free re render (spec 0011). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleChanges(request, (await params).id, takeHttpDeps());
}
