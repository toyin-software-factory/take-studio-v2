import { describe, expect, it } from "vitest";
import { callTool, type McpHandlers } from "./dispatch";
import { firstBatch, uploadSteps } from "./start-upload";
import { TOOLS } from "./tools";

/** Spec 0019 AC-5: the link shape and the chat fallback, with a fake R2 (fixed made up links). */
const TAKE = "7d6f3f0e-8b1a-4b57-9c52-0a1b2c3d4e5f";
const context = { origin: "https://take-studio.example", authorization: "Bearer tsk_x" };
const tool = TOOLS.find((t) => t.name === "start_upload")!;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function handlers(partCount: number, partsStatus = 200) {
  const seen: unknown[] = [];
  const table: McpHandlers = {
    "POST /api/uploads": async () => json(201, { takeId: TAKE, partSize: 16777216, partCount }),
    "POST /api/uploads/{takeId}/parts": async (request, params) => {
      const body = (await request.json()) as { partNumbers: number[] };
      seen.push({ params, body, auth: request.headers.get("authorization") });
      if (partsStatus !== 200) return json(partsStatus, { error: "x", message: "no" });
      return json(200, {
        parts: body.partNumbers.map((n) => ({
          partNumber: n,
          url: `https://r2.example/p${n}?sig=fake`,
        })),
        expiresInSeconds: 900,
      });
    },
  };
  return { table, seen };
}

describe("start_upload (AC-5)", () => {
  it("returns the take, the plan, the first links and plain steps", async () => {
    const { table, seen } = handlers(3);
    const out = await callTool(tool, { filename: "a.mp4", kind: "video/mp4" }, table, context);
    const body = JSON.parse(out.text);
    expect(out.isError).toBe(false);
    expect(out.takeId).toBe(TAKE);
    expect(body).toMatchObject({
      takeId: TAKE,
      partSize: 16777216,
      partCount: 3,
      expiresInSeconds: 900,
    });
    expect(body.parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([1, 2, 3]);
    expect(body.parts[0].url).toBe("https://r2.example/p1?sig=fake");
    expect(body.libraryUrl).toBe("https://take-studio.example/library");
    expect(body.steps).toContain("HTTP PUT");
    expect(body.steps).toContain("complete_upload");
    expect(seen).toEqual([
      { params: { takeId: TAKE }, body: { partNumbers: [1, 2, 3] }, auth: "Bearer tsk_x" },
    ]);
  });

  it("names the web app link for assistants that cannot send files", async () => {
    const { table } = handlers(1);
    const body = JSON.parse((await callTool(tool, {}, table, context)).text);
    expect(body.steps).toContain("https://take-studio.example/library");
    expect(body.steps).toContain("list_takes");
    expect(body.steps).toContain("plain chat");
  });

  it("asks for at most 50 links and says how to get the rest", async () => {
    const { table, seen } = handlers(80);
    const body = JSON.parse((await callTool(tool, {}, table, context)).text);
    expect(body.parts).toHaveLength(50);
    expect(firstBatch(80)).toHaveLength(50);
    expect(body.steps).toContain("1 to 50");
    expect(body.steps).toContain("get_upload_part_links");
    expect(seen).toHaveLength(1);
  });

  it("falls back to the plan and steps when the links call fails", async () => {
    const { table } = handlers(2, 503);
    const out = await callTool(tool, {}, table, context);
    const body = JSON.parse(out.text);
    expect(out.isError).toBe(false);
    expect(body.parts).toBeUndefined();
    expect(body).toMatchObject({ takeId: TAKE, partCount: 2 });
    expect(body.steps).toContain("Call get_upload_part_links");
  });

  it("passes a refusal of the create route through unchanged", async () => {
    const table: McpHandlers = {
      "POST /api/uploads": async () => json(429, { error: "limit_exceeded", message: "full" }),
    };
    const out = await callTool(tool, {}, table, context);
    expect(out).toMatchObject({ status: 429, isError: true });
    expect(JSON.parse(out.text).error).toBe("limit_exceeded");
  });

  it("the steps name no file address to fetch", () => {
    const text = uploadSteps({ takeId: TAKE, partSize: 5, partCount: 1 }, 1, "https://x/library");
    expect(text).not.toMatch(/fetch|download from/i);
  });
});
