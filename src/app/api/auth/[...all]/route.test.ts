import { describe, expect, it, vi } from "vitest";

const handler = vi.fn(async () => new Response("ok"));
vi.mock("@/server/request", () => ({ getAuth: async () => ({ handler }) }));

import { GET, POST } from "./route";

const call = (method: "GET" | "POST", path: string, authorization?: string) =>
  (method === "GET" ? GET : POST)(
    new Request(`https://studio.test${path}`, {
      method,
      headers: authorization ? { authorization } : {},
    }),
  );

describe("/api/auth Authorization header rule", () => {
  it("refuses a bearer value anywhere, and Basic outside token and revoke", async () => {
    handler.mockClear();
    for (const [method, path, header] of [
      ["POST", "/api/auth/sign-in/magic-link", "Bearer tsk_x"],
      ["POST", "/api/auth/oauth2/token", "Bearer abc"],
      ["POST", "/api/auth/oauth2/register", "Basic Zm9vOmJhcg=="],
      ["GET", "/api/auth/oauth2/token", "Basic Zm9vOmJhcg=="],
    ] as const) {
      const res = await call(method, path, header);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe("session_required");
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets HTTP Basic through only on POST token and revoke", async () => {
    for (const path of ["/api/auth/oauth2/token", "/api/auth/oauth2/revoke"]) {
      handler.mockClear();
      const res = await call("POST", path, "Basic Zm9vOmJhcg==");
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    }
  });
});
