import { uploadHttpDeps } from "@/server/backgrounds/upload-deps";
import { handleDeleteBackground } from "@/server/backgrounds/upload-http";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly id: string }> };

/** Deletes one of the creator's uploaded backgrounds and queues its files (spec 0008, AC-10). */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return handleDeleteBackground(request, (await params).id, uploadHttpDeps());
}
