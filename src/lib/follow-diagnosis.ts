/**
 * Names the step that made Follow my voice unavailable (B2-T87). A code only: no audio, no words,
 * no token, no script. The user message stays the same; the code goes to the browser console
 * (`voice following: <code>`), where a tester can read it.
 *
 * Codes: `token_<status>[_<step>]` (the token route; step is `no_key`, `usage` or `grant`),
 * `token_network`, `token_body`, `no_audio_track`, `audio_context`, `worklet`, `socket_close_<code>`.
 */
export type FollowFailureCode = string;

const SAFE = /^[a-z0-9_]{1,40}$/;

/** `audio_context` when the context could not be made, `worklet` for anything after it. */
export function pipeFailureCode(stage: "audio_context" | "worklet"): FollowFailureCode {
  return stage;
}

export function socketCloseCode(code: number | undefined): FollowFailureCode {
  return `socket_close_${Number.isInteger(code) ? code : "unknown"}`;
}

/** Logs the code; anything that is not a short lowercase code is dropped, never printed. */
export function reportFollowFailure(
  code: FollowFailureCode,
  warn: (message: string) => void = (m) => console.warn(m),
): void {
  if (SAFE.test(code)) warn(`voice following: ${code}`);
}
