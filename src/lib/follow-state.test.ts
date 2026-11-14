import { describe, expect, it } from "vitest";
import {
  FOLLOW_FALLBACK_MS,
  FOLLOW_NOTE_DROPPED,
  FOLLOW_NOTE_NO_MATCH,
  FOLLOW_NOTE_UNAVAILABLE,
  FOLLOW_OFF,
  type FollowEvent,
  followReducer,
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
