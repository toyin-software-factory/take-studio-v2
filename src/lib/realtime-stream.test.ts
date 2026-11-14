import { describe, expect, it, vi } from "vitest";
import {
  KEEP_ALIVE_MS,
  type SocketLike,
  connectRealtime,
  fetchRealtimeToken,
  realtimeUrl,
  wordsFromMessage,
} from "./realtime-stream";

function fakeSocket() {
  const sent: unknown[] = [];
  const s: Omit<SocketLike, "readyState"> & {
    readyState: number;
    open: () => void;
    say: (d: unknown) => void;
  } = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (d) => void sent.push(d),
    close: vi.fn(() => {
      s.readyState = 3;
    }),
    open: () => {
      s.readyState = 1;
      s.onopen?.();
    },
    say: (d) => s.onmessage?.({ data: d }),
  };
  return { s, sent };
}

function harness() {
  const { s, sent } = fakeSocket();
  const intervals: { fn: () => void; ms: number; id: number; cleared: boolean }[] = [];
  const createSocket = vi.fn((_u: string, _p: string[]) => s);
  const handlers = { onOpen: vi.fn(), onWords: vi.fn(), onClose: vi.fn() };
  const conn = connectRealtime("jwt-token", handlers, {
    createSocket,
    setInterval: (fn, ms) => {
      const e = { fn, ms, id: intervals.length, cleared: false };
      intervals.push(e);
      return e.id;
    },
    clearInterval: (id) => {
      const e = intervals[id as number];
      if (e) e.cleared = true;
    },
  });
  return { s, sent, intervals, createSocket, handlers, conn };
}

const result = (transcript: string) =>
  JSON.stringify({ type: "Results", channel: { alternatives: [{ transcript }] }, is_final: false });

describe("realtime stream (spec 0021 AC-12)", () => {
  it("asks for 16 kHz mono linear16 with interim results and no training", () => {
    const q = new URL(realtimeUrl()).searchParams;
    expect(q.get("encoding")).toBe("linear16");
    expect(q.get("sample_rate")).toBe("16000");
    expect(q.get("channels")).toBe("1");
    expect(q.get("interim_results")).toBe("true");
    expect(q.get("mip_opt_out")).toBe("true");
    expect(realtimeUrl()).not.toMatch(/token|key/i);
  });

  it("opens with the token as a bearer subprotocol only, never in the URL", () => {
    const { createSocket } = harness();
    const [url, protocols] = createSocket.mock.calls[0]!;
    expect(protocols).toEqual(["bearer", "jwt-token"]);
    expect(url).not.toContain("jwt-token");
  });

  it("hands words to the caller and ignores anything else", () => {
    const { s, handlers } = harness();
    s.open();
    s.say(result("hello there friend"));
    s.say(result("   "));
    s.say(JSON.stringify({ type: "Metadata" }));
    s.say("not json");
    s.say(new ArrayBuffer(2));
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onWords).toHaveBeenCalledTimes(1);
    expect(handlers.onWords).toHaveBeenCalledWith(["hello", "there", "friend"]);
  });

  it("sends a keep alive on the timer and audio only while open", () => {
    const { s, sent, intervals, conn } = harness();
    conn.sendAudio(new ArrayBuffer(4));
    expect(sent).toHaveLength(0);
    s.open();
    expect(intervals[0]!.ms).toBe(KEEP_ALIVE_MS);
    intervals[0]!.fn();
    conn.sendAudio(new ArrayBuffer(4));
    expect(sent[0]).toBe(JSON.stringify({ type: "KeepAlive" }));
    expect(sent[1]).toBeInstanceOf(ArrayBuffer);
  });

  it("tells the caller when the connection drops, and stops the timer", () => {
    const { s, intervals, handlers } = harness();
    s.open();
    s.onclose?.({ code: 1008 });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledWith(1008);
    expect(intervals[0]!.cleared).toBe(true);
  });

  it("reports a failed socket once, with the close code: error then close", () => {
    const { s, handlers } = harness();
    s.onerror?.();
    expect(handlers.onClose).not.toHaveBeenCalled();
    s.onclose?.({ code: 1006 });
    s.onclose?.({ code: 1006 });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledWith(1006);
  });

  it("closing it ourselves sends CloseStream and is not reported as a drop", () => {
    const { s, sent, handlers, conn } = harness();
    s.open();
    conn.close();
    s.onclose?.();
    expect(sent).toContain(JSON.stringify({ type: "CloseStream" }));
    expect(s.close).toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it("wordsFromMessage needs a string result with a transcript", () => {
    expect(wordsFromMessage(result("one two"))).toEqual(["one", "two"]);
    expect(wordsFromMessage(undefined)).toBeNull();
  });
});

describe("fetchRealtimeToken", () => {
  const reply = (status: number, body: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the token on 200", async () => {
    const r = await fetchRealtimeToken(reply(200, { token: "t", expiresInSeconds: 60 }));
    expect(r).toEqual({ ok: true, token: "t" });
  });

  it("maps limit, rate limit and everything else to typed failures with a step code", async () => {
    expect(await fetchRealtimeToken(reply(403))).toEqual({
      ok: false,
      error: "limit_exceeded",
      code: "token_403",
    });
    expect(await fetchRealtimeToken(reply(429))).toEqual({
      ok: false,
      error: "rate_limited",
      code: "token_429",
    });
    expect(await fetchRealtimeToken(reply(503))).toEqual({
      ok: false,
      error: "unavailable",
      code: "token_503",
    });
    expect(await fetchRealtimeToken(reply(401))).toMatchObject({ code: "token_401" });
    expect(await fetchRealtimeToken(reply(200, { nope: 1 }))).toEqual({
      ok: false,
      error: "unavailable",
      code: "token_body",
    });
    const boom = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await fetchRealtimeToken(boom)).toEqual({
      ok: false,
      error: "unavailable",
      code: "token_network",
    });
  });

  it("calls a 200 with invalid JSON token_body, not a network failure", async () => {
    const bad = vi.fn(async () => new Response("{", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchRealtimeToken(bad)).toEqual({
      ok: false,
      error: "unavailable",
      code: "token_body",
    });
  });

  it("adds the server's step name to a 503 code, and ignores anything else in the body", async () => {
    for (const step of ["no_key", "usage", "grant"]) {
      expect(await fetchRealtimeToken(reply(503, { error: "unavailable", step }))).toMatchObject({
        code: `token_503_${step}`,
      });
    }
    expect(await fetchRealtimeToken(reply(503, { step: "my secret text" }))).toMatchObject({
      code: "token_503",
    });
  });
});
