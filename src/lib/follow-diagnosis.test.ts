import { describe, expect, it, vi } from "vitest";
import { pipeFailureCode, reportFollowFailure, socketCloseCode } from "./follow-diagnosis";

describe("follow diagnosis", () => {
  it("names the socket close code, or unknown", () => {
    expect(socketCloseCode(1006)).toBe("socket_close_1006");
    expect(socketCloseCode(undefined)).toBe("socket_close_unknown");
  });

  it("names the pipe stage", () => {
    expect(pipeFailureCode("audio_context")).toBe("audio_context");
    expect(pipeFailureCode("worklet")).toBe("worklet");
  });

  it("prints a short lowercase code and drops anything else", () => {
    const warn = vi.fn();
    reportFollowFailure("token_503_grant", warn);
    expect(warn).toHaveBeenCalledWith("voice following: token_503_grant");
    reportFollowFailure("Hello there, these are my words", warn);
    reportFollowFailure("a".repeat(41), warn);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
