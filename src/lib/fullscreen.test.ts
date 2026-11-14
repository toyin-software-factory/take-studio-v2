import { describe, expect, it, vi } from "vitest";
import { enterFullscreen, pickFullscreen, type FullscreenTarget } from "./fullscreen";

describe("pickFullscreen", () => {
  it("prefers the standard method over the prefixed ones", () => {
    const calls: string[] = [];
    const target: FullscreenTarget = {
      requestFullscreen: () => void calls.push("standard"),
      webkitRequestFullscreen: () => void calls.push("prefixed"),
      webkitEnterFullscreen: () => void calls.push("ios"),
    };
    pickFullscreen(target)?.();
    expect(calls).toEqual(["standard"]);
  });

  it("falls back to webkitRequestFullscreen, then webkitEnterFullscreen (iPhone Safari)", () => {
    const calls: string[] = [];
    pickFullscreen({
      webkitRequestFullscreen: () => void calls.push("prefixed"),
      webkitEnterFullscreen: () => void calls.push("ios"),
    })?.();
    pickFullscreen({ webkitEnterFullscreen: () => void calls.push("ios") })?.();
    expect(calls).toEqual(["prefixed", "ios"]);
  });

  it("calls the method on the element itself", () => {
    const target = {
      seen: null as unknown,
      webkitEnterFullscreen(this: { seen: unknown }) {
        this.seen = this;
      },
    };
    pickFullscreen(target)?.();
    expect(target.seen).toBe(target);
  });

  it("is null when the element has none, or a non function", () => {
    expect(pickFullscreen({})).toBeNull();
    expect(pickFullscreen({ requestFullscreen: undefined })).toBeNull();
  });
});

describe("enterFullscreen", () => {
  it("is true when the method works, including a promise one", async () => {
    expect(await enterFullscreen({ webkitEnterFullscreen: () => undefined })).toBe(true);
    expect(await enterFullscreen({ requestFullscreen: () => Promise.resolve() })).toBe(true);
  });

  it("stays harmless: false for nothing, no method, a rejection or a throw", async () => {
    expect(await enterFullscreen(null)).toBe(false);
    expect(await enterFullscreen({})).toBe(false);
    expect(
      await enterFullscreen({ requestFullscreen: () => Promise.reject(new Error("no")) }),
    ).toBe(false);
    const throws = vi.fn(() => {
      throw new Error("not ready");
    });
    expect(await enterFullscreen({ webkitEnterFullscreen: throws })).toBe(false);
    expect(throws).toHaveBeenCalledOnce();
  });
});
