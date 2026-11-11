import { describe, expect, it } from "vitest";
import { debugIdSnippet, withWinningDebugId } from "./sentry-debug-id";

const id = "4817d38d-57e1-5bd9-839f-8418bb52c6d7";
const other = "56699d50-2d33-b91c-2b45-2b0fc72e67f9";
const bundle = `!function(){/* sentry-cli's own snippet, ${id} */}();\nconsole.log("worker");\n//# debugId=${id}\n`;

describe("withWinningDebugId", () => {
  it("puts the snippet right before the final debugId comment", () => {
    const result = withWinningDebugId(bundle);
    expect(result).toEqual({
      ok: true,
      data: `!function(){/* sentry-cli's own snippet, ${id} */}();\nconsole.log("worker");\n${debugIdSnippet(id)}\n//# debugId=${id}\n`,
    });
  });

  it("uses the id of the last comment, so it is registered after every other snippet", () => {
    const text = `a();\n//# debugId=${other}\nb();\n//# debugId=${id}\n`;
    const result = withWinningDebugId(text);
    expect(result.ok && result.data.endsWith(`${debugIdSnippet(id)}\n//# debugId=${id}\n`)).toBe(
      true,
    );
  });

  it("registers the id under the SDK's keys", () => {
    const snippet = debugIdSnippet(id);
    expect(snippet).toContain(`_sentryDebugIds[(new e.Error).stack]="${id}"`);
    expect(snippet).toContain(`_sentryDebugIdIdentifier="sentry-dbid-${id}"`);
  });

  it("is idempotent", () => {
    const once = withWinningDebugId(bundle);
    expect(once.ok && withWinningDebugId(once.data)).toEqual(once);
  });

  it("refuses a bundle with no debugId comment", () => {
    expect(withWinningDebugId("console.log(1);\n")).toMatchObject({ ok: false });
  });

  it("changes nothing else", () => {
    const result = withWinningDebugId(bundle);
    expect(result.ok && result.data.replace(`${debugIdSnippet(id)}\n`, "")).toBe(bundle);
  });
});
