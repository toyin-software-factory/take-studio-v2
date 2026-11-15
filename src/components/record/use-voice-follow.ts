"use client";

import { useEffect, useReducer, useRef } from "react";
import { followScript, normaliseWord, scriptWordsOf } from "@/lib/follow-script";
import { callApi } from "@/components/takes/browser-io";
import { keepRunning } from "./keep-running";
import {
  FOLLOW_OFF,
  followAudioAllowed,
  followReducer,
  type FollowStatus,
} from "@/lib/follow-state";
import { pipeFailureCode, reportFollowFailure, socketCloseCode } from "@/lib/follow-diagnosis";
import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "@/lib/pcm-worklet";
import {
  type AudioGate,
  connectRealtime,
  createAudioGate,
  fetchRealtimeToken,
  type RealtimeConnection,
  type SocketLike,
} from "@/lib/realtime-stream";

/** The token call through `callApi` (bounded, same origin), shaped like a `fetch` for `fetchRealtimeToken`. */
const tokenFetch: typeof fetch = async (input) => {
  const reply = await callApi(String(input), "POST");
  const empty = reply.data === null || [204, 205, 304].includes(reply.status);
  return new Response(empty ? null : JSON.stringify(reply.data), { status: reply.status });
};

export type VoiceFollow = {
  readonly status: FollowStatus;
  /** Index of the next script word to say (words split on whitespace); null until a word matches. */
  readonly wordIndex: number | null;
  /** A visible sentence for the fallback, or null. */
  readonly note: string | null;
};

type Audio = {
  readonly ctx: AudioContext;
  readonly url: string;
  readonly stop: () => void;
};

/** How piping the microphone went: handles, no audio track, or a failure with its stage. */
type PipeResult =
  | { readonly kind: "ok"; readonly audio: Audio }
  | { readonly kind: "no_track" }
  | { readonly kind: "failed"; readonly stage: "audio_context" | "worklet" };

/** Take the microphone only (never the video) and stream it as 16 kHz frames into `conn`. */
async function pipeMicrophone(
  stream: MediaStream,
  send: (frame: ArrayBuffer) => void,
): Promise<PipeResult> {
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) return { kind: "no_track" };
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    // Firefox throws when the context rate differs from the microphone's. The worklet resamples
    // from whatever rate the context runs at, so a native rate context works the same.
    try {
      ctx = new AudioContext();
    } catch {
      return { kind: "failed", stage: "audio_context" };
    }
  }
  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, { numberOfOutputs: 0 });
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => send(event.data);
    ctx.createMediaStreamSource(new MediaStream(tracks)).connect(node);
    return { kind: "ok", audio: { ctx, url, stop: keepRunning(ctx) } };
  } catch {
    // The caller never gets the handles on failure, so release them here.
    releaseAudio({ ctx, url, stop: () => undefined });
    return { kind: "failed", stage: "worklet" };
  }
}

function releaseAudio(audio: Audio): void {
  audio.stop();
  URL.revokeObjectURL(audio.url);
  void audio.ctx.close();
}

/**
 * Voice following for the prompter (spec 0021 step 2, AC-12; B2-T115). While `enabled`, the token
 * is fetched and the Deepgram socket opened when the countdown starts, so it is ready before the
 * creator reads. The microphone is only piped, and only goes to Deepgram, while `recording`: the
 * audio gate drops anything earlier. No audio and no words are stored, logged or sent anywhere
 * but Deepgram; any trouble becomes the `fallback` status and the prompter keeps its timed scroll.
 */
export function useVoiceFollow(args: {
  readonly script: string;
  readonly stream: MediaStream | null;
  readonly enabled: boolean;
  /** The 3 2 1 countdown is running: connect now, send no audio yet. */
  readonly countdown: boolean;
  readonly recording: boolean;
  /** The prompter's current position in words, read when following starts and again when a heard phrase matches nothing near the last match (0 for a new take). */
  readonly startWord: () => number;
}): VoiceFollow {
  const { script, stream, enabled, countdown, recording } = args;
  const connect = enabled && (countdown || recording);
  const startWord = useRef(args.startWord);
  useEffect(() => {
    startWord.current = args.startWord;
  }, [args.startWord]);
  const [state, dispatch] = useReducer(followReducer, FOLLOW_OFF);
  // The latest state for the recording effect, which must not re-run when it changes.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const scriptWords = useRef<readonly string[]>([]);
  const last = useRef(-1);
  const gate = useRef<AudioGate | null>(null);
  // Read once when the connection starts: true when it started before recording (the countdown).
  const recordingNow = useRef(recording);
  useEffect(() => {
    recordingNow.current = recording;
  }, [recording]);

  useEffect(() => {
    scriptWords.current = scriptWordsOf(script).map(normaliseWord);
  }, [script]);

  // The connection: opened at the countdown (or when turned on while recording), closed when
  // following is turned off, recording ends or the page is left.
  useEffect(() => {
    if (!connect || !stream) return;
    let cancelled = false;
    let conn: RealtimeConnection | null = null;
    const audioGate = createAudioGate((frame) => conn?.sendAudio(frame));
    gate.current = audioGate;
    // Start matching where the prompter already is, so following turned on mid script can match
    // the words ahead instead of searching from the top.
    last.current = Math.max(-1, Math.floor(startWord.current()) - 1);
    dispatch({ type: "start", now: Date.now(), early: !recordingNow.current });
    const timer = setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);

    void (async () => {
      const token = await fetchRealtimeToken(tokenFetch);
      if (cancelled || !followAudioAllowed(stateRef.current)) return;
      if (!token.ok) {
        reportFollowFailure(token.code);
        dispatch({ type: "unavailable" });
        return;
      }
      conn = connectRealtime(
        token.token,
        {
          onOpen: () => {
            // The hold ran out while connecting: the screen says following is off, so stay silent.
            if (!followAudioAllowed(stateRef.current)) {
              conn?.close();
              return;
            }
            audioGate.open();
            dispatch({ type: "open", now: Date.now() });
          },
          onClose: (code) => {
            reportFollowFailure(socketCloseCode(code));
            dispatch({ type: "closed" });
          },
          onWords: (words) => {
            let next = followScript(scriptWords.current, words, last.current);
            if (!next.advanced) {
              // Timed scrolling may have carried the script past the match window while the voice
              // was lost: try again from the word the prompter now shows (forward only).
              const shown = Math.floor(startWord.current()) - 1;
              if (next.repeat || shown <= last.current) return;
              next = followScript(scriptWords.current, words, shown);
              if (!next.advanced) return;
            }
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
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      conn?.close();
      audioGate.stopRecording();
      gate.current = null;
      dispatch({ type: "stop" });
    };
  }, [connect, stream]);

  // Recording started: start the clock for matches, then (and only then) pipe the microphone.
  useEffect(() => {
    if (!connect || !recording || !stream) return;
    let cancelled = false;
    let audio: Audio | null = null;
    // Still connecting when the hold ends: the reducer falls back, so say why (one code, no data).
    if (stateRef.current.early && stateRef.current.status === "connecting") {
      reportFollowFailure("hold_expired");
    }
    dispatch({ type: "recording", now: Date.now() });
    gate.current?.startRecording();
    void (async () => {
      try {
        const piped = await pipeMicrophone(stream, (frame) => gate.current?.push(frame));
        if (piped.kind === "ok" && cancelled) {
          // Follow was turned off while the worklet loaded: cleanup has run, so release now.
          releaseAudio(piped.audio);
          return;
        }
        if (piped.kind === "ok") audio = piped.audio;
        else if (!cancelled) {
          reportFollowFailure(
            piped.kind === "no_track" ? "no_audio_track" : pipeFailureCode(piped.stage),
          );
          dispatch({ type: "unavailable" });
        }
      } catch {
        if (!cancelled) {
          reportFollowFailure(pipeFailureCode("worklet"));
          dispatch({ type: "unavailable" });
        }
      }
    })();
    return () => {
      cancelled = true;
      gate.current?.stopRecording();
      if (audio) releaseAudio(audio);
    };
  }, [connect, recording, stream]);

  return {
    status: state.status,
    wordIndex: state.wordIndex === null ? null : state.wordIndex + 1,
    note: state.note,
  };
}
