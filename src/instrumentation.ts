import type { Instrumentation } from "next";
import { captureException } from "@sentry/core";

/**
 * `next dev` (Node.js) gets the full server SDK. In the Worker, src/worker.ts creates the
 * client; loading @sentry/nextjs's Node SDK there would double the bundle (spec 0005, AC-8).
 */
export async function register() {
  if (process.env.NODE_ENV === "development" && process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
}

/**
 * Errors from server components, route handlers and server actions (spec 0005, AC-1). Uses
 * the light core API, which reports through the client the Worker (or `next dev`) created.
 * Tags carry the route template (`/takes/[id]`), never the real path or query.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  captureException(error, {
    tags: {
      runtime: "web",
      route: context.routePath,
      routeType: context.routeType,
      method: request.method,
    },
  });
};
