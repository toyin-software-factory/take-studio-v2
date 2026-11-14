import { parseWebEnv } from "@/lib/env";
import { apiAuthDeps } from "../api-auth-deps";
import { libraryHttpDeps } from "../backgrounds/library-deps";
import { previewHttpDeps } from "../backgrounds/preview-deps";
import { mediaHttpDeps, takeHttpDeps, transcriptHttpDeps } from "../takes/deps";
import { uploadHttpDeps } from "../uploads/deps";
import { usageHttpDeps } from "../usage/deps";
import { buildHandlers } from "./handlers";
import type { McpHttpDeps } from "./http";

/** The real dependencies of `POST /mcp`: the shared key check and the real route handlers. */
export function mcpHttpDeps(): McpHttpDeps {
  const { keyAuth } = apiAuthDeps();
  return {
    keyAuth,
    baseUrl: () => parseWebEnv().BETTER_AUTH_URL,
    handlers: buildHandlers({
      usage: usageHttpDeps,
      take: takeHttpDeps,
      media: mediaHttpDeps,
      transcript: transcriptHttpDeps,
      upload: uploadHttpDeps,
      library: libraryHttpDeps,
      preview: previewHttpDeps,
    }),
  };
}
