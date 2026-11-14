import { describe, expect, it, vi } from "vitest";
import { SHARED_TAKE_ID, runReadTake } from "./run-read-take";

const TOKEN = "read-token-0123456789";

describe("runReadTake (temporary, B2-T36)", () => {
  it("opens no database for a wrong token, a wrong take ID or a bad payload", async () => {
    const db = vi.fn();
    const log = vi.fn();
    for (const payload of [
      { token: "nope", takeId: SHARED_TAKE_ID },
      { token: TOKEN, takeId: "00000000-0000-4000-8000-000000000000" },
      { token: TOKEN },
      { takeId: SHARED_TAKE_ID },
      null,
    ]) {
      expect(await runReadTake(payload, TOKEN, db, log)).toEqual({ outcome: "skipped" });
    }
    expect(await runReadTake({ token: TOKEN, takeId: SHARED_TAKE_ID }, undefined, db, log)).toEqual(
      { outcome: "skipped" },
    );
    expect(db).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("with the token and the shared take ID, reads it and logs counts only", async () => {
    const transcript = {
      words: [{ w: "secret", startMs: 0, endMs: 100, conf: 1, filler: false, para: false }],
      edits: [],
    };
    const executor = {
      select: () => ({
        from: () => ({ where: () => ({ orderBy: async () => [] }) }),
      }),
    };
    const log = vi.fn();
    const getTranscript = vi.fn(async () => transcript);
    vi.resetModules();
    vi.doMock("@/db/data/transcripts", () => ({ getTranscriptByTake: getTranscript }));
    const { runReadTake: run, SHARED_TAKE_ID: id } = await import("./run-read-take");
    const out = await run(
      { token: TOKEN, takeId: id },
      TOKEN,
      async () => ({ run: (fn) => fn(executor as never) }),
      log,
    );
    expect(out).toMatchObject({ outcome: "read", words: [[0, "secret", 0, 100, false]] });
    expect(getTranscript).toHaveBeenCalledWith(executor, id);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    expect(log).toHaveBeenCalledWith("read-take: read", { words: 1, cuts: 0 });
  });
});
