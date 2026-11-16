import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import { GUEST_COOKIE } from "@/lib/guest-rules";
import { guard, type ApiAuthDeps } from "../api-auth";
import { handleAbort, handleComplete, handleCreate, handleParts } from "../uploads/http";
import { fakeR2, ORIGIN, request } from "../uploads/uploads-test-helpers";
import { body, guestDeps, guestRequest } from "./guest-test-helpers";
import { handleGuestCreate } from "./http";
import { guestCookieValue, liveGuest } from "./session";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_guest_refused" });
});
afterAll(() => testDb?.close());

async function drop() {
  const { r2 } = fakeR2();
  const up = { db: testDb.db, r2, dispatchProbe: async () => undefined };
  const res = await handleGuestCreate(guestRequest(), guestDeps(up));
  const cookie = /ts_guest=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  return { r2, cookie, takeId: ((await res.json()) as { takeId: string }).takeId };
}

/** Upload handler deps whose session lookup finds nobody and whose guest lookup reads the cookie. */
const uploadDeps = (r2: ReturnType<typeof fakeR2>["r2"]) => ({
  allowedOrigin: ORIGIN,
  getCreator: async () => null,
  getGuest: async (req: Request, takeId?: string) =>
    liveGuest(testDb.db, guestCookieValue(req.headers.get("cookie")), new Date(), takeId),
  uploadDeps: (db: typeof testDb.db) => ({ db, r2, dispatchProbe: async () => undefined }),
});
const withCookie = (cookie: string, payload?: unknown) => {
  const req = request("POST", payload);
  req.headers.set("cookie", `${GUEST_COOKIE}=${cookie}`);
  return req;
};

describe("the guest cookie is opt in per route (spec 0023, G6, AC-1, AC-10)", () => {
  it("is accepted by parts, complete and abort for the guest's own take", async () => {
    const { r2, cookie, takeId } = await drop();
    const deps = uploadDeps(r2);
    const parts = await handleParts(withCookie(cookie, { partNumbers: [1] }), takeId, deps);
    expect(parts.status).toBe(200);
    const complete = await handleComplete(withCookie(cookie, { parts: [] }), takeId, deps);
    expect(complete.status).not.toBe(401);
    const abort = await handleAbort(withCookie(cookie), takeId, deps);
    expect(abort.status).not.toBe(401);
  });

  it("is refused for another take, and by POST /api/uploads", async () => {
    const a = await drop();
    const b = await drop();
    const deps = uploadDeps(a.r2);
    const other = await handleParts(withCookie(a.cookie, { partNumbers: [1] }), b.takeId, deps);
    expect(other.status).toBe(401);
    const create = await handleCreate(
      withCookie(a.cookie, { fileName: "a.mov", sizeBytes: 1000, container: "mov" }),
      deps,
    );
    expect(create.status).toBe(401);
  });

  it("is refused by an expired or claimed guest", async () => {
    const { cookie, takeId } = await drop();
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await liveGuest(testDb.db, cookie, later, takeId)).toBeNull();
    expect(await liveGuest(testDb.db, cookie, new Date(), takeId)).not.toBeNull();
  });

  it("is never read by the guard on a route that did not opt in", async () => {
    const { cookie } = await drop();
    let looked = 0;
    const deps: ApiAuthDeps = {
      allowedOrigin: ORIGIN,
      getCreator: async () => null,
      getGuest: async () => {
        looked += 1;
        return { db: testDb.db, creatorId: "x", guest: true };
      },
    };
    for (const method of ["GET", "POST", "DELETE", "PUT", "PATCH"]) {
      for (const checkOrigin of [false, true]) {
        const req = new Request(`${ORIGIN}/api/takes`, {
          method,
          headers: { cookie: `${GUEST_COOKIE}=${cookie}`, origin: ORIGIN },
        });
        const res = await guard(req, deps, { checkOrigin });
        expect((res as Response).status).toBe(401);
      }
    }
    expect(looked).toBe(0);
  });

  it("uses the cookie for the guest's own take even when someone else is signed in", async () => {
    const { cookie, takeId } = await drop();
    const creator = await createCreator(testDb.db);
    const deps = {
      ...uploadDeps(fakeR2().r2),
      getCreator: async () => ({ db: testDb.db, creatorId: creator.id }),
    };
    const res = await handleParts(withCookie(cookie, { partNumbers: [1] }), takeId, deps);
    expect(res.status).toBe(200);
  });

  it("is read only by the upload routes: allowGuest appears nowhere else", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
          if (readFileSync(path, "utf8").includes("allowGuest")) hits.push(path);
        }
      }
    };
    walk("src");
    expect(hits.sort()).toEqual(["src/server/api-auth.ts", "src/server/uploads/http.ts"]);
    expect(body.turnstileToken).toBeTruthy();
  });
});
