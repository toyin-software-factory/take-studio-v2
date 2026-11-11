import { handleMedia } from "@/server/media";
import { mediaHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** A short lived signed link to play or download the take's video (AC-9, AC-12). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleMedia(request, (await params).id, mediaHttpDeps());
}
