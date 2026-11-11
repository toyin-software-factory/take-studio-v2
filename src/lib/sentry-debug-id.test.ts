import vm from "node:vm";
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

  it("registers the id under the SDK's name", () => {
    expect(debugIdSnippet(id)).toContain(`e._sentryDebugIdIdentifier="sentry-dbid-${id}"`);
  });

  describe("running in a bundle (the production order)", () => {
    /** The snippet the Sentry plugins put in every chunk, as esbuild prints it. */
    const chunkSnippet = (x: string) =>
      `"use strict";(function(){try{var e=globalThis,n=new e.Error().stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="${x}",e._sentryDebugIdIdentifier="sentry-dbid-${x}")}catch(e){}})();`;
    /** Next's own snippet, as Turbopack writes it above every chunk. */
    const nativeSnippet = (x: string) =>
      `"use strict";(function(){try{var e=globalThis,n=new e.Error().stack;n&&((e._debugIds||(e._debugIds={}))[n]="${x}")}catch(e){}})();`;
    const registered = (context: vm.Context, registry = "_sentryDebugIds") =>
      vm.runInContext(`Object.values(globalThis.${registry})`, context) as string[];

    it("holds only our id when a chunk registered before and a lazy module registers after", () => {
      const context = vm.createContext({});
      vm.runInContext(chunkSnippet(other), context);
      vm.runInContext(debugIdSnippet(id), context);
      vm.runInContext(chunkSnippet("11111111-1111-4111-8111-111111111111"), context);
      expect(registered(context)).toEqual([id]);
    });

    it("holds only our id in Next's native registry too (the SDK reads it last)", () => {
      const context = vm.createContext({});
      vm.runInContext(nativeSnippet(other), context);
      vm.runInContext(debugIdSnippet(id), context);
      vm.runInContext(nativeSnippet("11111111-1111-4111-8111-111111111111"), context);
      expect(registered(context, "_debugIds")).toEqual([id]);
      expect(registered(context)).toEqual([id]);
    });

    it("never throws into the bundle, even in strict code", () => {
      const context = vm.createContext({});
      vm.runInContext(debugIdSnippet(id), context);
      expect(() =>
        vm.runInContext(
          '"use strict"; globalThis._sentryDebugIds = {}; globalThis._sentryDebugIds.x = "y"; delete globalThis._sentryDebugIds.x;',
          context,
        ),
      ).not.toThrow();
      expect(registered(context)).toEqual([id]);
    });

    it("is safe when the bundle is evaluated again: no error, and the registry keeps our id", () => {
      const context = vm.createContext({});
      vm.runInContext(debugIdSnippet(id), context);
      expect(() => vm.runInContext(debugIdSnippet(id), context)).not.toThrow();
      expect(() => vm.runInContext(debugIdSnippet(other), context)).not.toThrow();
      expect(registered(context)).toEqual([id]);
    });

    it("sets the identifier even when something else already locked the registry", () => {
      const context = vm.createContext({});
      vm.runInContext(
        'Object.defineProperty(globalThis, "_sentryDebugIds", { value: {}, configurable: false })',
        context,
      );
      expect(() => vm.runInContext(debugIdSnippet(id), context)).not.toThrow();
      expect(vm.runInContext("globalThis._sentryDebugIdIdentifier", context)).toBe(
        `sentry-dbid-${id}`,
      );
    });

    it("prefers globalThis", () => {
      expect(debugIdSnippet(id).indexOf("globalThis?globalThis")).toBeLessThan(
        debugIdSnippet(id).indexOf("window?window"),
      );
    });

    it("works when nothing registered before it", () => {
      const context = vm.createContext({});
      vm.runInContext(debugIdSnippet(id), context);
      expect(registered(context)).toEqual([id]);
    });
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
