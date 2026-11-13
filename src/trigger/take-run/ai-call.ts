import Anthropic from "@anthropic-ai/sdk";
import { AI_EDIT, AI_EDIT_JSON_SCHEMA, type AiCause, type AiRequest } from "@/lib/ai-edit";

/** What one Claude call gave back: the text of the answer, why it stopped, and token counts. */
export type AiCallResult = {
  readonly text: string | null;
  readonly stopReason: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

/** A failed call, already classified. `retryable` is true for 429, 5xx and network errors. */
export class AiCallError extends Error {
  constructor(
    readonly cause: Extract<AiCause, "timeout" | "provider_error" | "provider_rejected">,
    readonly retryable: boolean,
  ) {
    super(cause);
  }
}

/** Maps an SDK error to our classes. Typed errors only, never string matching. */
export function classifyAiError(error: unknown, signal: AbortSignal): AiCallError {
  // The edit deadline fired: whatever the call died of, the cause is the deadline.
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) {
    return new AiCallError("timeout", false);
  }
  if (error instanceof AiCallError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return new AiCallError("timeout", false);
  if (error instanceof Anthropic.APIConnectionError) return new AiCallError("provider_error", true);
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 429 || status >= 500) return new AiCallError("provider_error", true);
    return new AiCallError("provider_rejected", false);
  }
  return new AiCallError("provider_error", false);
}

/**
 * The one Claude call (spec 0012, AC-9): structured output, no streaming, SDK retries off. The
 * model rejects `thinking: disabled`, so thinking stays at its default and `effort` is `low`.
 * `signal` is the remaining edit deadline. Never logs the request or the answer.
 */
export async function callClaude(
  request: AiRequest,
  apiKey: string,
  signal: AbortSignal,
): Promise<AiCallResult> {
  const client = new Anthropic({ apiKey, maxRetries: AI_EDIT.sdkMaxRetries });
  try {
    const message = await client.messages.create(
      {
        model: AI_EDIT.model,
        max_tokens: AI_EDIT.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: {
          effort: AI_EDIT.effort,
          format: { type: "json_schema", schema: AI_EDIT_JSON_SCHEMA },
        },
      },
      { signal },
    );
    const block = message.content.find((b) => b.type === "text");
    return {
      text: block && block.type === "text" ? block.text : null,
      stopReason: message.stop_reason,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  } catch (error) {
    throw classifyAiError(error, signal);
  }
}
