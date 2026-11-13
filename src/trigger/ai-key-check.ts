import Anthropic from "@anthropic-ai/sdk";
import { logger, task } from "@trigger.dev/sdk";
import { AI_EDIT } from "@/lib/ai-edit";
import {
  type AiKeyCheckResult,
  type RawOutcome,
  aiKeyCheckPayloadSchema,
  buildCheckedResult,
  errorTypeFrom,
  keyFingerprint,
} from "@/lib/ai-key-check";
import { sentryCheckAllowed } from "@/lib/sentry-check";

/**
 * TEMPORARY (B-T17, C-15): tests the Anthropic key from Trigger.dev cloud, because the sandbox
 * proxy replaces the key on api.anthropic.com. Manual only (the app never triggers it). It acts
 * only when the payload token equals the SENTRY_CHECK_TOKEN of the Trigger.dev environment
 * (constant time, like `sentry-check`); otherwise it does nothing. It makes ONE request (same SDK
 * setup as the ai_edit step: no SDK retries) with a fixed tiny prompt and returns and logs only
 * the status, request ID, retry-after, the `anthropic-ratelimit-*` headers, the error type and
 * the key's hash prefix and length. Never the key, the prompt or any answer text. Removed after
 * C-15.
 */
export type AiKeyCheckIo = {
  /** The one request. Must resolve with the stripped outcome, never throw. */
  readonly call: (apiKey: string) => Promise<RawOutcome>;
};

export const realAiKeyCheckIo: AiKeyCheckIo = {
  call: async (apiKey) => {
    const client = new Anthropic({ apiKey, maxRetries: AI_EDIT.sdkMaxRetries, timeout: 30_000 });
    try {
      const { response } = await client.messages
        .create({
          model: AI_EDIT.model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Say ok." }],
        })
        .withResponse();
      return { status: response.status, headers: response.headers, errorType: null };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        return {
          status: error.status ?? null,
          headers: error.headers,
          errorType: errorTypeFrom(error.error),
        };
      }
      return { status: null, headers: null, errorType: "connection_error" };
    }
  },
};

/** The check itself, apart from Trigger.dev. */
export async function runAiKeyCheck(
  payload: unknown,
  env: { readonly token: string | undefined; readonly apiKey: string | undefined },
  io: AiKeyCheckIo,
): Promise<AiKeyCheckResult> {
  const parsed = aiKeyCheckPayloadSchema.safeParse(payload);
  if (!parsed.success || !(await sentryCheckAllowed(parsed.data.token, env.token))) {
    return { outcome: "skipped" };
  }
  if (!env.apiKey) return { outcome: "no_key" };
  const [fingerprint, raw] = await Promise.all([keyFingerprint(env.apiKey), io.call(env.apiKey)]);
  return buildCheckedResult(raw, fingerprint);
}

export const aiKeyCheckTask = task({
  id: "ai-key-check",
  machine: "micro",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: async (payload: unknown) => {
    const result = await runAiKeyCheck(
      payload,
      { token: process.env.SENTRY_CHECK_TOKEN, apiKey: process.env.ANTHROPIC_API_KEY },
      realAiKeyCheckIo,
    );
    logger.info("ai-key-check", result);
    return result;
  },
});
