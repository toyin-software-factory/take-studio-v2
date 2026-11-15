import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getDb, notFound } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(async () => ({})),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/server/request", () => ({ getSession, getDb }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/analytics/report", () => ({
  funnel: vi.fn(async () => {
    throw new Error("report must not run for a stranger");
  }),
  foundingMembers: vi.fn(),
  cutQuality: vi.fn(),
  cutTest: vi.fn(),
}));

// Imported once at the top (vi.mock is hoisted above it), not inside the first test: the cold
// import of the page module is slow under load and used to eat that test's 5 s timeout.
import InsightsPage, * as insightsModule from "./page";

const page = async () => InsightsPage({ searchParams: Promise.resolve({}) });

beforeEach(() => {
  getSession.mockReset();
  getDb.mockClear();
  notFound.mockClear();
  vi.unstubAllEnvs();
});

describe("/insights gate (spec 0016, AC-8)", () => {
  it("is a 404 for a visitor with no session, before any database or report call", async () => {
    vi.stubEnv("INSIGHTS_VIEWER_USER_ID", "viewer-1");
    getSession.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("is a 404 for another signed in creator", async () => {
    vi.stubEnv("INSIGHTS_VIEWER_USER_ID", "viewer-1");
    getSession.mockResolvedValue({
      user: { id: "someone-else", name: "A", email: "a@example.test" },
    });
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("is a 404, not a 500, when the viewer is not configured, even for a signed in user", async () => {
    vi.stubEnv("INSIGHTS_VIEWER_USER_ID", "");
    getSession.mockResolvedValue({ user: { id: "viewer-1", name: "A", email: "a@example.test" } });
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("is dynamic and noindex", async () => {
    const mod = insightsModule;
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.metadata.robots).toEqual({ index: false, follow: false });
  });
});
