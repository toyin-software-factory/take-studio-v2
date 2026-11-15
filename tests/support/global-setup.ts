import { chromium, type FullConfig } from "@playwright/test";
import { workerOriginProblem } from "./built-env";
import { signIn } from "./session";

/**
 * B2-T137: before any test runs, sign a synthetic user in the way the specs do and ask the
 * running Worker who it is. If the Worker does not know the session, every signed in spec would
 * land on the sign in page and fail far from the cause, so stop here and name the usual causes.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("playwright.config.ts has no baseURL");
  const problem = workerOriginProblem(baseURL);
  if (problem) throw new Error(problem);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const { user, cleanup } = await signIn(context, baseURL, "Setup Check");
    try {
      const reply = await context.request.get(`${baseURL}/api/auth/get-session`);
      const body: unknown = await reply.json().catch(() => null);
      const known =
        typeof body === "object" && body !== null && "user" in body && body.user !== null;
      if (!known) {
        throw new Error(
          `The Worker at ${baseURL} did not accept the test session for ${user.id} (HTTP ${reply.status()}). ` +
            "Usual causes: the Worker was built in a shell that had BETTER_AUTH_SECRET or BETTER_AUTH_URL set " +
            "(a build bakes those in ahead of .env: rebuild with a clean env, see tests/AGENTS.md), " +
            "or an old preview server on this port is still running (stop it), " +
            "or the Worker uses another database than the tests. " +
            "Steps: tests/AGENTS.md.",
        );
      }
    } finally {
      await cleanup();
    }
  } finally {
    await browser.close();
  }
}
