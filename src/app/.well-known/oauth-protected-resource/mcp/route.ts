import { protectedResourceResponse } from "@/server/oauth/metadata";

export const dynamic = "force-dynamic";

/** Spec 0019 AC-13: where a client learns which server signs people in for `/mcp`. */
export function GET(): Response {
  return protectedResourceResponse();
}
