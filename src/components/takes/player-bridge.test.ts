import { describe, expect, it, vi } from "vitest";
import { createPlayerBridge } from "./player-bridge";

describe("player bridge preview and back (S3S-T14)", () => {
  it("calls the registered back handler, and does nothing after it is removed", () => {
    const bridge = createPlayerBridge();
    const back = vi.fn();
    bridge.back();
    bridge.setBack(back);
    bridge.back();
    expect(back).toHaveBeenCalledTimes(1);
    bridge.setBack(null);
    bridge.back();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("tells listeners when the action in the stage line changes, not only the picture", () => {
    const bridge = createPlayerBridge();
    const listener = vi.fn();
    bridge.subscribe(listener);
    const base = {
      kind: "image",
      label: "Calm studio",
      url: "u",
      action: "Use this background",
    } as const;
    bridge.setPreview(base);
    bridge.setPreview({ ...base });
    expect(listener).toHaveBeenCalledTimes(1);
    bridge.setPreview({ ...base, action: "Keep original" });
    expect(listener).toHaveBeenCalledTimes(2);
    bridge.setPreview(null);
    expect(bridge.getPreview()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
