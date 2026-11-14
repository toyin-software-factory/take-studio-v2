import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const getDb = vi.fn(async () => ({}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("@/server/request", () => ({ getSession, getDb }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/analytics/report", () => ({
  funnel: vi.fn(async () => {
    throw new Error("report must not run for a stranger");
  }),
  foundingMembers: vi.fn(),
  cutQuality: vi.fn(),
}));

const page = async () => {
  const { default: InsightsPage } = await import("./page");
  return InsightsPage({ searchParams: Promise.resolve({}) });
};

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
    const mod = await import("./page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.metadata.robots).toEqual({ index: false, follow: false });
  });
});
