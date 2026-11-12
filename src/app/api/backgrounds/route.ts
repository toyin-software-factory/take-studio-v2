import { libraryHttpDeps } from "@/server/backgrounds/library-deps";
import { handleListBackgrounds } from "@/server/backgrounds/library-http";
import { uploadHttpDeps } from "@/server/backgrounds/upload-deps";
import { handleCreateBackground } from "@/server/backgrounds/upload-http";

export const dynamic = "force-dynamic";

/** The built in studios and the creator's own backgrounds, for the picker (spec 0008, AC-1). */
export function GET(request: Request): Promise<Response> {
  return handleListBackgrounds(request, libraryHttpDeps());
}

/** Starts a background upload: a presigned PUT for the image (spec 0008, AC-8). */
export function POST(request: Request): Promise<Response> {
  return handleCreateBackground(request, uploadHttpDeps());
}
