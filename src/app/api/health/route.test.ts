import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The health route (spec 0001 scaffold checklist item 3). The database (Hyperdrive), R2 and
 * the env are boundaries, so they are mocked; the deployed check runs against the real ones.
 */
const dbExecute = vi.fn<() => Promise<unknown>>();
const r2Reachable = vi.fn<() => Promise<boolean>>();

vi.mock("@/server/request", () => ({
  getDb: async () => ({ execute: dbExecute }),
}));
vi.mock("@/lib/r2", () => ({
  createR2: () => ({ isReachable: r2Reachable }),
}));
vi.mock("@/lib/env", () => ({
  parseWebEnv: () => ({}),
}));

const { GET } = await import("./route");

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbExecute.mockReset().mockResolvedValue([]);
  r2Reachable.mockReset().mockResolvedValue(true);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  vi.useRealTimers();
});

describe("GET /api/health", () => {
  it("returns 200 ok, uncached, when the database and R2 are reachable", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", checks: { database: "ok", storage: "ok" } });
  });

  it("returns 503 degraded when the database query fails", async () => {
    dbExecute.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:secret@db"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "degraded",
      checks: { database: "error", storage: "ok" },
    });
  });

  it("returns 503 degraded when the R2 bucket is unreachable", async () => {
    r2Reachable.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ checks: { database: "ok", storage: "error" } });
  });

  it("gives up on a check that hangs, after its 5 second deadline", async () => {
    vi.useFakeTimers();
    dbExecute.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ checks: { database: "error", storage: "ok" } });
  });

  it("logs only the check name and error class, never the error message", async () => {
    dbExecute.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:secret@db"));
    await GET();
    expect(errorLog).toHaveBeenCalledWith("health check failed", {
      check: "database",
      reason: "Error",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret");
  });
});
