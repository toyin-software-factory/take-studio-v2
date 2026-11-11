import { handleRetry } from "@/server/takes/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** "Try again" after a refundable failure (AC-10). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleRetry(request, (await params).id, takeHttpDeps());
}
