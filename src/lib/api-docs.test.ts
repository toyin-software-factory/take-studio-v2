import { describe, expect, it } from "vitest";
import { API_REGISTRY, routeKey } from "./api-registry";
import { API_ERRORS, API_LIMITS, UPLOAD_STEPS, groupRoutes } from "./api-docs";

describe("api docs content (spec 0018 AC-11)", () => {
  it("puts every registry route in exactly one group", () => {
    const groups = groupRoutes(API_REGISTRY);
    const keys = groups.flatMap((g) => g.routes.map(routeKey));
    expect([...keys].sort()).toEqual(API_REGISTRY.map(routeKey).sort());
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  });

  it("walks the upload flow with only routes that are in the registry", () => {
    const known = new Set(API_REGISTRY.map((r) => r.path.replace(/\{[^}]+\}/g, "*")));
    const used = UPLOAD_STEPS.flatMap((s) =>
      [...s.command.matchAll(/\$BASE(\/api\/[^\s"?]+)/g)].map((m) =>
        (m[1] ?? "").replace(/\$[A-Z_]+/g, "*"),
      ),
    );
    expect(used.length).toBeGreaterThanOrEqual(5);
    for (const path of used) expect(known, path).toContain(path);
  });

  it("never puts a key in a link or a real secret in an example", () => {
    for (const step of UPLOAD_STEPS) {
      expect(step.command).not.toMatch(/tsk_[A-Za-z0-9_-]{43}/);
      expect(step.command).not.toMatch(/[?&](key|token|api_key)=/);
    }
  });

  it("states the limits it quotes from the rules", () => {
    expect(API_LIMITS.join(" ")).toContain("5 keys");
    expect(API_LIMITS.join(" ")).toContain("120 requests a minute");
    expect(API_LIMITS.join(" ")).toContain("60 free minutes");
    expect(API_LIMITS.join(" ")).toContain("10 uploads an hour");
  });

  it("lists error codes once each with an HTTP status", () => {
    const codes = API_ERRORS.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of API_ERRORS) expect(e.status).toBeGreaterThanOrEqual(400);
    expect(codes).toContain("invalid_api_key");
    expect(codes).toContain("rate_limited");
  });
});
