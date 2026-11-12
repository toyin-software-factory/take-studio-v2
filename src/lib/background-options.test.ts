import { describe, expect, it } from "vitest";
import { selectOptions } from "./background-options";

const blue = { id: "b1", name: "Studio blue" };
const warm = { id: "b2", name: "Studio warm" };

describe("selectOptions (spec 0008)", () => {
  it("lists what the API returned, and nothing more when the choice is among them", () => {
    expect(selectOptions([blue, warm], blue, "b1")).toEqual([blue, warm]);
    expect(selectOptions([blue, warm], null, "original")).toEqual([blue, warm]);
  });

  it("keeps the background the video is on when the list could not be loaded", () => {
    // The list failed: only the current background is known, and Keep original is separate.
    expect(selectOptions([], { id: "b1", name: "Studio blue" }, "b1")).toEqual([blue]);
    expect(selectOptions([], { id: "b1", name: "Studio blue" }, "original")).toEqual([blue]);
  });

  it("adds a placeholder for a choice it cannot name, such as a failed change's target", () => {
    expect(selectOptions([], null, "b9")).toEqual([{ id: "b9", name: "Your earlier choice" }]);
    expect(selectOptions([blue], blue, "b9")).toEqual([
      blue,
      { id: "b9", name: "Your earlier choice" },
    ]);
  });

  it("never lists the original, nor a keyed render whose background was deleted", () => {
    expect(selectOptions([], { id: null, name: "Studio gone" }, "original")).toEqual([]);
  });

  it("does not repeat an option the list already has", () => {
    expect(selectOptions([blue], { id: "b1", name: "Studio blue" }, "b1")).toEqual([blue]);
  });
});
