import { handleWaveform } from "@/server/changes/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** The stored waveform of the original's audio, or null (spec 0011, AC-11). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleWaveform(request, (await params).id, takeHttpDeps());
}
