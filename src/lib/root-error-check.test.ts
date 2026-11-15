import { describe, expect, it, vi } from "vitest";
import { ROOT_ERROR_CHECK_HEADER, shouldThrowRootError } from "./root-error-check";

const withHeader = (value: string | null) => async () =>
  new Headers(value === null ? {} : { [ROOT_ERROR_CHECK_HEADER]: value });

describe("shouldThrowRootError (B2-T155)", () => {
  it("throws only when the gallery is on and the header is 1", async () => {
    expect(await shouldThrowRootError(true, withHeader("1"))).toBe(true);
    expect(await shouldThrowRootError(true, withHeader(null))).toBe(false);
    expect(await shouldThrowRootError(true, withHeader("0"))).toBe(false);
    expect(await shouldThrowRootError(true, withHeader("true"))).toBe(false);
  });

  it("never throws, and never reads the headers, when the gallery is off", async () => {
    const read = vi.fn(withHeader("1"));
    expect(await shouldThrowRootError(false, read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers false, not an error, when the render has no request to read", async () => {
    const none = async (): Promise<Pick<Headers, "get">> => {
      throw new Error("headers was called outside a request scope");
    };
    expect(await shouldThrowRootError(true, none)).toBe(false);
  });

  it("uses a header name no real client sends", () => {
    expect(ROOT_ERROR_CHECK_HEADER).toBe("x-root-error-check");
  });
});
