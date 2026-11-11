import { mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";

export type Link =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "error" };

/** A fresh 1 hour play link, or an error. */
export async function playLink(takeId: string): Promise<Link> {
  const reply = await callApi(`/api/takes/${takeId}/media?kind=play`, "GET").catch(() => null);
  const parsed = mediaLinkSchema.safeParse(reply?.data);
  return reply?.status === 200 && parsed.success
    ? { kind: "ready", url: parsed.data.url }
    : { kind: "error" };
}
