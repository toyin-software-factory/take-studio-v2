import type { Db } from "@/db/types";
import type { ApiAuthDeps } from "../api-auth";
import { type McpRouteDeps, buildHandlers } from "./handlers";
import type { McpHttpDeps } from "./http";

/**
 * Test only wiring (never imported by the Worker): the real route handlers over a test database,
 * with the same fakes the API parity test uses. Shared by the MCP test files.
 */
export const TEST_ORIGIN = "https://take-studio.example";
export const TEST_NOW = new Date("2026-11-10T12:00:00Z");
const SECRET = "x".repeat(40);

export const testIdentity = (db: Db): ApiAuthDeps => ({
  getCreator: async () => null,
  keyAuth: { getDb: async () => db, now: () => TEST_NOW },
});

export function testRouteDeps(db: Db): McpRouteDeps {
  const base = testIdentity(db);
  const take = () => ({
    ...base,
    allowedOrigin: TEST_ORIGIN,
    usageSecret: () => SECRET,
    triggerProcessTake: async () => ({ id: "run" }),
    now: () => TEST_NOW,
  });
  return {
    usage: () => ({ ...base, usageSecret: () => SECRET, now: () => TEST_NOW }),
    take,
    media: () => ({
      ...base,
      allowedOrigin: TEST_ORIGIN,
      headObject: async () => ({ size: 10 }),
      presignGet: async () => "https://r2.example/link",
      now: () => TEST_NOW,
    }),
    transcript: () => ({
      ...base,
      allowedOrigin: TEST_ORIGIN,
      triggerTranscribe: async () => ({ id: "run" }),
      now: () => TEST_NOW,
    }),
    upload: () => ({
      ...base,
      allowedOrigin: TEST_ORIGIN,
      uploadDeps: (database) => ({
        db: database,
        r2: {
          createMultipartUpload: async () => "u",
          presignUploadPart: async () => "https://r2.example/part",
          completeMultipartUpload: async () => undefined,
          abortMultipartUpload: async () => undefined,
          headObject: async () => ({ size: 10 }),
        },
        dispatchProbe: async () => undefined,
      }),
      usageSecret: () => SECRET,
      now: () => TEST_NOW,
    }),
    library: () => ({
      ...base,
      allowedOrigin: TEST_ORIGIN,
      presignGet: async () => "https://r2.example/thumb",
    }),
    preview: () => ({
      ...base,
      allowedOrigin: TEST_ORIGIN,
      triggerPreview: async () => ({ id: "run" }),
      presignGet: async () => "https://r2.example/still",
      now: () => TEST_NOW,
    }),
  };
}

export const testMcpDeps = (db: Db, route: McpRouteDeps = testRouteDeps(db)): McpHttpDeps => ({
  keyAuth: testIdentity(db).keyAuth,
  baseUrl: () => TEST_ORIGIN,
  handlers: buildHandlers(route),
});
