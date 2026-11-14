import { describe, expect, it, vi } from "vitest";
import { keepRunning, type ResumableContext } from "./keep-running";

function fake(state: string) {
  const listeners = new Set<() => void>();
  const context = {
    state,
    resume: vi.fn(() => Promise.resolve()),
    addEventListener: (_: "statechange", l: () => void) => listeners.add(l),
    removeEventListener: (_: "statechange", l: () => void) => listeners.delete(l),
  } satisfies ResumableContext;
  return { context, listeners, fire: () => listeners.forEach((l) => l()) };
}

describe("keepRunning", () => {
  it("resumes a context that starts suspended", () => {
    const { context } = fake("suspended");
    keepRunning(context, null);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("leaves a running context alone", () => {
    const { context } = fake("running");
    keepRunning(context, null);
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("resumes again when the context is suspended later, and stops after cleanup", () => {
    const { context, fire, listeners } = fake("running");
    const stop = keepRunning(context, null);
    context.state = "suspended";
    fire();
    expect(context.resume).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("retries on the next tap when the browser refused", () => {
    const { context } = fake("suspended");
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (n: string, h: () => void) => handlers.set(n, h),
      removeEventListener: (n: string) => handlers.delete(n),
    } as unknown as Document;
    keepRunning(context, target);
    handlers.get("pointerdown")?.();
    expect(context.resume).toHaveBeenCalledTimes(2);
  });
});
