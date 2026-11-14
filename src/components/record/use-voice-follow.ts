"use client";

import { useEffect, useReducer, useRef } from "react";
import { followScript, normaliseWord, scriptWordsOf } from "@/lib/follow-script";
import { FOLLOW_OFF, followReducer, type FollowStatus } from "@/lib/follow-state";
import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "@/lib/pcm-worklet";
import {
  connectRealtime,
  fetchRealtimeToken,
  type RealtimeConnection,
  type SocketLike,
} from "@/lib/realtime-stream";

export type VoiceFollow = {
  readonly status: FollowStatus;
  /** Index of the next script word to say (words split on whitespace); null until a word matches. */
  readonly wordIndex: number | null;
  /** A visible sentence for the fallback, or null. */
  readonly note: string | null;
};

type Audio = { readonly ctx: AudioContext; readonly url: string };

/** Take the microphone only (never the video) and stream it as 16 kHz frames into `conn`. */
async function pipeMicrophone(
  stream: MediaStream,
  conn: RealtimeConnection,
): Promise<Audio | null> {
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) return null;
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, { numberOfOutputs: 0 });
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => conn.sendAudio(event.data);
  ctx.createMediaStreamSource(new MediaStream(tracks)).connect(node);
  return { ctx, url };
}

/**
 * Voice following for the prompter (spec 0021 step 2, AC-12). While `enabled` and `recording`, it
 * streams the microphone to Deepgram through a short lived token and reports where the creator is
 * in the script. No audio and no words are stored, logged or sent anywhere but Deepgram; any
 * trouble becomes the `fallback` status and the prompter keeps its timed scroll.
 */
export function useVoiceFollow(args: {
  readonly script: string;
  readonly stream: MediaStream | null;
  readonly enabled: boolean;
  readonly recording: boolean;
}): VoiceFollow {
  const { script, stream, enabled, recording } = args;
  const [state, dispatch] = useReducer(followReducer, FOLLOW_OFF);
  const scriptWords = useRef<readonly string[]>([]);
  const last = useRef(-1);

  useEffect(() => {
    scriptWords.current = scriptWordsOf(script).map(normaliseWord);
  }, [script]);

  useEffect(() => {
    if (!enabled || !recording || !stream) return;
    let cancelled = false;
    let conn: RealtimeConnection | null = null;
    let audio: Audio | null = null;
    last.current = -1;
    dispatch({ type: "start", now: Date.now() });
    const timer = setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);

    void (async () => {
      const token = await fetchRealtimeToken(fetch);
      if (cancelled) return;
      if (!token.ok) {
        dispatch({ type: "unavailable" });
        return;
      }
      conn = connectRealtime(
        token.token,
        {
          onOpen: () => dispatch({ type: "open", now: Date.now() }),
          onClose: () => dispatch({ type: "closed" }),
          onWords: (words) => {
            const next = followScript(scriptWords.current, words, last.current);
            if (!next.advanced) return;
            last.current = next.matchIndex;
            dispatch({ type: "match", index: next.matchIndex, now: Date.now() });
          },
        },
        {
          createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
          setInterval: (fn, ms) => setInterval(fn, ms),
          clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
        },
      );
      try {
        audio = await pipeMicrophone(stream, conn);
        if (!audio && !cancelled) dispatch({ type: "unavailable" });
      } catch {
        if (!cancelled) dispatch({ type: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      conn?.close();
      if (audio) {
        URL.revokeObjectURL(audio.url);
        void audio.ctx.close();
      }
      dispatch({ type: "stop" });
    };
  }, [enabled, recording, stream]);

  return {
    status: state.status,
    wordIndex: state.wordIndex === null ? null : state.wordIndex + 1,
    note: state.note,
  };
}
