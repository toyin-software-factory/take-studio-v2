import { z } from "zod";

/**
 * Deepgram streaming for voice following (spec 0021 step 2, AC-12), browser side. Everything here
 * is injected (socket factory, fetch, timers) so a test drives it with a fake socket. Heard words
 * go to `onWords` and nowhere else: never logged, never stored, never sent to analytics. The token
 * is a secret and is only ever the socket's subprotocol, never a URL or a log line.
 */

export const REALTIME_LISTEN_URL = "wss://api.deepgram.com/v1/listen";
/** Deepgram closes a quiet socket after about 10 seconds; a keep alive every 4 is well inside. */
export const KEEP_ALIVE_MS = 4000;

/** `mip_opt_out` keeps the audio out of model training, the same as the transcript request. */
export const REALTIME_OPTIONS = {
  model: "nova-3",
  language: "multi",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
  interim_results: "true",
  punctuate: "false",
  smart_format: "false",
  filler_words: "false",
  mip_opt_out: "true",
} as const;

export const realtimeUrl = (): string =>
  `${REALTIME_LISTEN_URL}?${new URLSearchParams(REALTIME_OPTIONS).toString()}`;

const resultsSchema = z.object({
  type: z.literal("Results"),
  channel: z.object({ alternatives: z.array(z.object({ transcript: z.string() })).min(1) }),
});

/** The words of one Deepgram message, or null when it is not a result with words (metadata, empty). */
export function wordsFromMessage(data: unknown): readonly string[] | null {
  if (typeof data !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = resultsSchema.safeParse(json);
  const text = parsed.success ? parsed.data.channel.alternatives[0]?.transcript.trim() : "";
  return text ? text.split(/\s+/) : null;
}

const tokenSchema = z.object({ token: z.string().min(1), expiresInSeconds: z.number().positive() });

export type TokenFailure = "limit_exceeded" | "rate_limited" | "unavailable";
export type TokenResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly error: TokenFailure };

/** Ask our server for a short lived token. Any trouble is a typed failure, never a throw. */
export async function fetchRealtimeToken(fetchFn: typeof fetch): Promise<TokenResult> {
  try {
    const res = await fetchFn("/api/realtime/token", {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.status === 403) return { ok: false, error: "limit_exceeded" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) return { ok: false, error: "unavailable" };
    const body = tokenSchema.safeParse(await res.json());
    return body.success
      ? { ok: true, token: body.data.token }
      : { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** The part of a WebSocket we use; the real one satisfies it. */
export type SocketLike = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBufferLike): void;
  close(): void;
};
export const SOCKET_OPEN = 1;

export type RealtimeDeps = {
  readonly createSocket: (url: string, protocols: string[]) => SocketLike;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (id: unknown) => void;
};

export type RealtimeHandlers = {
  readonly onOpen: () => void;
  readonly onWords: (words: readonly string[]) => void;
  readonly onClose: () => void;
};

export type RealtimeConnection = {
  /** Send one audio frame; dropped quietly when the socket is not open. */
  readonly sendAudio: (frame: ArrayBufferLike) => void;
  /** Close for good. `onClose` is not called for a close we asked for. */
  readonly close: () => void;
};

/** Open the socket with the token as a `bearer` subprotocol and wire words, keep alive and close. */
export function connectRealtime(
  token: string,
  handlers: RealtimeHandlers,
  deps: RealtimeDeps,
): RealtimeConnection {
  const socket = deps.createSocket(realtimeUrl(), ["bearer", token]);
  let timer: unknown = null;
  let closedByUs = false;
  const stopTimer = () => {
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
  };
  socket.onopen = () => {
    timer = deps.setInterval(() => {
      if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ type: "KeepAlive" }));
    }, KEEP_ALIVE_MS);
    handlers.onOpen();
  };
  socket.onmessage = (event) => {
    const words = wordsFromMessage(event.data);
    if (words) handlers.onWords(words);
  };
  const ended = () => {
    stopTimer();
    if (!closedByUs) handlers.onClose();
  };
  socket.onclose = ended;
  socket.onerror = ended;
  return {
    sendAudio: (frame) => {
      if (socket.readyState === SOCKET_OPEN) socket.send(frame);
    },
    close: () => {
      closedByUs = true;
      stopTimer();
      try {
        if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}
