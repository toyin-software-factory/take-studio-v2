import { describe, expect, it } from "vitest";
import { DELETE_MESSAGES, deleteOutcome } from "./take-delete";

describe("deleteOutcome (spec 0013 AC-4)", () => {
  it("counts 204 as done", () => expect(deleteOutcome(204)).toBe("done"));
  it("counts 404 as done: a retry after a lost reply finds it already gone", () =>
    expect(deleteOutcome(404)).toBe("done"));
  it("keeps 401 apart so the dialog can say the session ended", () =>
    expect(deleteOutcome(401)).toBe("signed_out"));
  it.each([403, 409, 500, 502])("treats %i as a server failure", (status) =>
    expect(deleteOutcome(status)).toBe("failed"),
  );
  it("treats no answer as unknown, never as failed", () => {
    expect(deleteOutcome(null)).toBe("unknown");
    expect(deleteOutcome(0)).toBe("unknown");
  });
  it("words unknown differently from a server error", () =>
    expect(DELETE_MESSAGES.unknown).not.toBe(DELETE_MESSAGES.failed));
});

import { afterCardDelete, takeCountText } from "./take-delete";

describe("afterCardDelete (spec 0013 AC-5)", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("focuses the next card", () =>
    expect(afterCardDelete(list, "b")).toEqual({
      takes: [{ id: "a" }, { id: "c" }],
      focusId: "c",
    }));
  it("focuses the previous card when the last one goes", () =>
    expect(afterCardDelete(list, "c").focusId).toBe("b"));
  it("focuses nothing (the upload area) when the list is empty", () =>
    expect(afterCardDelete([{ id: "a" }], "a")).toEqual({ takes: [], focusId: null }));
  it("changes nothing for an unknown id", () =>
    expect(afterCardDelete(list, "z")).toEqual({ takes: list, focusId: null }));
});

describe("takeCountText", () => {
  it("counts", () => {
    expect(takeCountText(1, false)).toBe("1 take");
    expect(takeCountText(3, false)).toBe("3 takes");
    expect(takeCountText(24, true)).toBe("24+ takes");
  });
});
