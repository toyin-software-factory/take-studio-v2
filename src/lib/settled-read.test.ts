import { describe, expect, it } from "vitest";
import { awaitRead, startRead } from "./settled-read";

describe("startRead and awaitRead", () => {
  it("hands back the value of a read that worked", async () => {
    expect(await awaitRead(startRead(Promise.resolve(42)))).toBe(42);
  });

  it("rethrows the same error when the child awaits a failed read", async () => {
    const failure = new Error("usage read failed");
    await expect(awaitRead(startRead(Promise.reject(failure)))).rejects.toBe(failure);
  });

  it("never leaves a rejection unhandled while nobody awaits it yet", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const started = startRead(Promise.reject(new Error("late child")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
      await expect(awaitRead(started)).rejects.toThrow("late child");
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});
