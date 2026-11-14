import { handleUsage } from "../usage/http";
import { usageHttpDeps } from "../usage/deps";
import { handleList } from "../takes/http";
import { takeHttpDeps } from "../takes/deps";
import { parseWebEnv } from "@/lib/env";
import { apiAuthDeps } from "../api-auth-deps";
import type { McpHttpDeps } from "./http";

/** The real dependencies of `POST /mcp`: the shared key check and the real route handlers. */
export function mcpHttpDeps(): McpHttpDeps {
  const { keyAuth } = apiAuthDeps();
  return {
    keyAuth,
    baseUrl: () => parseWebEnv().BETTER_AUTH_URL,
    handlers: {
      get_usage: (request) => handleUsage(request, usageHttpDeps()),
      list_takes: (request) => handleList(request, takeHttpDeps()),
    },
  };
}
