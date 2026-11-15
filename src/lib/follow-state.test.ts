import { describe, expect, it } from "vitest";
import {
  FOLLOW_FALLBACK_MS,
  FOLLOW_NOTE_DROPPED,
  FOLLOW_NOTE_NO_MATCH,
  FOLLOW_NOTE_UNAVAILABLE,
  FOLLOW_OFF,
  VOICE_HOLD_MS,
  type FollowEvent,
  followReducer,
  holdCountdown,
} from "./follow-state";

const run = (events: FollowEvent[]) => events.reduce(followReducer, FOLLOW_OFF);

describe("followReducer (spec 0021 AC-12)", () => {
  it("starts connecting, follows on a match and never moves back", () => {
    const s = run([
      { type: "start", now: 0 },
      { type: "open", now: 100 },
      { type: "match", index: 5, now: 1000 },
      { type: "match", index: 3, now: 1500 },
    ]);
    expect(s).toMatchObject({ status: "following", wordIndex: 5, note: null });
  });

  it("falls back with a note after 5 seconds with no match, not before", () => {
    const start = run([{ type: "start", now: 0 }]);
    expect(followReducer(start, { type: "tick", now: FOLLOW_FALLBACK_MS - 1 }).status).toBe(
      "connecting",
    );
    expect(followReducer(start, { type: "tick", now: FOLLOW_FALLBACK_MS })).toMatchObject({
      status: "fallback",
      note: FOLLOW_NOTE_NO_MATCH,
    });
  });

  it("counts the 5 seconds from the last match", () => {
    const s = run([
      { type: "start", now: 0 },
      { type: "match", index: 2, now: 4000 },
      { type: "tick", now: 8000 },
    ]);
    expect(s.status).toBe("following");
    expect(followReducer(s, { type: "tick", now: 9000 }).status).toBe("fallback");
  });

  it("comes back from a quiet fallback on the next match", () => {
    const quiet = run([
      { type: "start", now: 0 },
      { type: "tick", now: 6000 },
    ]);
    const back = followReducer(quiet, { type: "match", index: 7, now: 7000 });
    expect(back).toMatchObject({ status: "following", wordIndex: 7, note: null });
  });

  it("a dropped connection falls back at once and stays there", () => {
    const s = run([
      { type: "start", now: 0 },
      { type: "match", index: 4, now: 500 },
      { type: "closed" },
      { type: "match", index: 9, now: 600 },
    ]);
    expect(s).toMatchObject({ status: "fallback", note: FOLLOW_NOTE_DROPPED, wordIndex: 4 });
  });

  it("an unavailable token falls back with its own note; stop resets everything", () => {
    const s = run([{ type: "start", now: 0 }, { type: "unavailable" }]);
    expect(s).toMatchObject({ status: "fallback", note: FOLLOW_NOTE_UNAVAILABLE });
    expect(followReducer(s, { type: "stop" })).toEqual(FOLLOW_OFF);
  });

  it("ignores events while off", () => {
    expect(followReducer(FOLLOW_OFF, { type: "match", index: 1, now: 1 })).toEqual(FOLLOW_OFF);
    expect(followReducer(FOLLOW_OFF, { type: "tick", now: 99999 })).toEqual(FOLLOW_OFF);
    expect(followReducer(FOLLOW_OFF, { type: "closed" })).toEqual(FOLLOW_OFF);
  });
});

describe("following that starts at the countdown (B2-T115)", () => {
  const early = (events: FollowEvent[]) => run([{ type: "start", now: 0, early: true }, ...events]);

  it("connects, then is ready when the socket opens, before recording", () => {
    expect(early([]).status).toBe("connecting");
    expect(early([{ type: "open", now: 300 }]).status).toBe("ready");
  });

  it("does not run the no match clock until recording starts", () => {
    const ready = early([{ type: "open", now: 300 }]);
    // Well past 5 seconds of countdown and hold, still no fallback.
    expect(followReducer(ready, { type: "tick", now: 3000 + VOICE_HOLD_MS + 1 }).status).toBe(
      "ready",
    );
    const connecting = early([]);
    expect(followReducer(connecting, { type: "tick", now: 60_000 }).status).toBe("connecting");
  });

  it("counts the 5 seconds of silence from the moment recording starts", () => {
    const rec = early([
      { type: "open", now: 300 },
      { type: "recording", now: 8000 },
    ]);
    expect(rec.status).toBe("ready");
    expect(followReducer(rec, { type: "tick", now: 8000 + FOLLOW_FALLBACK_MS - 1 }).status).toBe(
      "ready",
    );
    expect(followReducer(rec, { type: "tick", now: 8000 + FOLLOW_FALLBACK_MS })).toMatchObject({
      status: "fallback",
      note: FOLLOW_NOTE_NO_MATCH,
    });
  });

  it("falls back with the unavailable note when still connecting as recording starts", () => {
    const s = early([{ type: "recording", now: 8000 }]);
    expect(s).toMatchObject({ status: "fallback", note: FOLLOW_NOTE_UNAVAILABLE, dropped: true });
    // A late open or match does not bring it back.
    expect(followReducer(s, { type: "match", index: 3, now: 9000 }).status).toBe("fallback");
  });

  it("a refused token during the countdown ends the hold with the unavailable note", () => {
    const s = early([{ type: "unavailable" }]);
    expect(s).toMatchObject({ status: "fallback", note: FOLLOW_NOTE_UNAVAILABLE });
    expect(holdCountdown({ enabled: true, status: s.status, heldMs: 0 })).toBe(false);
  });

  it("turned on during recording it keeps the old behaviour: connecting, then the 5 s clock", () => {
    const s = run([{ type: "start", now: 1000 }]);
    expect(s.status).toBe("connecting");
    expect(followReducer(s, { type: "recording", now: 1000 }).status).toBe("connecting");
    expect(followReducer(s, { type: "tick", now: 1000 + FOLLOW_FALLBACK_MS }).status).toBe(
      "fallback",
    );
  });

  it("stop and a late recording event after stop change nothing", () => {
    expect(followReducer(FOLLOW_OFF, { type: "recording", now: 5 })).toEqual(FOLLOW_OFF);
    expect(followReducer(early([]), { type: "stop" })).toEqual(FOLLOW_OFF);
  });
});

describe("holdCountdown (B2-T115): the countdown waits at 0 for up to 5 seconds", () => {
  const base = { enabled: true, status: "connecting" } as const;

  it("holds while connecting, for less than 5 seconds", () => {
    expect(holdCountdown({ ...base, heldMs: 0 })).toBe(true);
    expect(holdCountdown({ ...base, heldMs: VOICE_HOLD_MS - 1 })).toBe(true);
  });

  it("stops holding at 5 seconds", () => {
    expect(holdCountdown({ ...base, heldMs: VOICE_HOLD_MS })).toBe(false);
  });

  it("never holds when following is off, ready, following or fallen back", () => {
    expect(holdCountdown({ ...base, enabled: false, heldMs: 0 })).toBe(false);
    for (const status of ["off", "ready", "following", "fallback"] as const) {
      expect(holdCountdown({ enabled: true, status, heldMs: 0 })).toBe(false);
    }
  });
});
