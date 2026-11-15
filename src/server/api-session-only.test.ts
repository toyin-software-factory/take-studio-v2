import { describe, expect, it } from "vitest";
import { API_EXCLUSIONS, routeKey } from "@/lib/api-registry";
import { handleCreate, handleList, handleRevoke, type ApiKeyHttpDeps } from "./api-keys/http";
import { handleDisconnect, handleList as handleConnectedList } from "./oauth/http";
import { handleToken, type RealtimeHttpDeps } from "./realtime/http";

/**
 * Spec 0018 AC-4 (B2-T90): every route the registry excludes as `session-only` refuses any
 * `Authorization` header with 401 `session_required`, and checks Origin first on writes. The
 * session is never read beside a header. Synthetic requests only; the handlers answer before they
 * touch a database or another service, so the deps carry no real ones.
 */
const ORIGIN = "https://take-studio.example";
const ID = "3f2b8c1e-5a47-4d0e-9b61-0c7a2d9e4f10";

type Deps = { readonly keys: ApiKeyHttpDeps; readonly realtime: RealtimeHttpDeps };

function makeDeps() {
  const state = { sessionReads: 0 };
  const getCreator = async () => {
    state.sessionReads++;
    return null;
  };
  const keys: ApiKeyHttpDeps = { allowedOrigin: ORIGIN, getCreator };
  const realtime: RealtimeHttpDeps = { allowedOrigin: ORIGIN, getCreator, deepgramKey: () => null };
  return { state, base: { keys, realtime } satisfies Deps };
}

type Call = (headers: Record<string, string>) => Promise<Response>;

function calls(base: Deps): Readonly<Record<string, Call>> {
  const url = (path: string) => `${ORIGIN}${path}`;
  return {
    "GET /api/keys": (h) => handleList(new Request(url("/api/keys"), { headers: h }), base.keys),
    "POST /api/keys": (h) =>
      handleCreate(
        new Request(url("/api/keys"), {
          method: "POST",
          headers: { "content-type": "application/json", ...h },
          body: JSON.stringify({ name: "x" }),
        }),
        base.keys,
      ),
    "DELETE /api/keys/{id}": (h) =>
      handleRevoke(
        new Request(url(`/api/keys/${ID}`), { method: "DELETE", headers: h }),
        ID,
        base.keys,
      ),
    "GET /api/connected-apps": (h) =>
      handleConnectedList(new Request(url("/api/connected-apps"), { headers: h }), base.keys),
    "DELETE /api/connected-apps/{id}": (h) =>
      handleDisconnect(
        new Request(url(`/api/connected-apps/${ID}`), { method: "DELETE", headers: h }),
        ID,
        base.keys,
      ),
    "POST /api/realtime/token": (h) =>
      handleToken(
        new Request(url("/api/realtime/token"), { method: "POST", headers: h }),
        base.realtime,
      ),
  };
}

const sessionOnly = API_EXCLUSIONS.filter((e) => e.reason === "session-only").map(routeKey);
const WRITES = sessionOnly.filter((k) => !k.startsWith("GET "));

describe("session only routes (AC-4, B2-T90)", () => {
  it("this test names every session only route the registry lists", () => {
    expect(Object.keys(calls(makeDeps().base)).sort()).toEqual([...sessionOnly].sort());
  });

  it.each(sessionOnly)(
    "%s answers a bearer with 401 session_required, never reads the cookie",
    async (name) => {
      const { state, base } = makeDeps();
      const call = calls(base)[name]!;
      for (const authorization of ["Bearer tsk_whatever", "Basic abc", ""]) {
        const res = await call({ origin: ORIGIN, authorization });
        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: string }).error).toBe("session_required");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(state.sessionReads).toBe(0);
    },
  );

  it.each(WRITES)("%s checks Origin before the bearer, so a wrong Origin is 403", async (name) => {
    const { state, base } = makeDeps();
    const res = await calls(base)[name]!({
      origin: "https://evil.example",
      authorization: "Bearer tsk_whatever",
    });
    expect(res.status).toBe(403);
    expect(state.sessionReads).toBe(0);
  });

  it.each(sessionOnly)("%s with no header and no session is 401 unauthorized", async (name) => {
    const { base } = makeDeps();
    const res = await calls(base)[name]!({ origin: ORIGIN });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });
});
