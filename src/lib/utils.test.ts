import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a text colour next to a type scale size", () => {
    expect(cn("text-primary-foreground", "text-small")).toBe("text-primary-foreground text-small");
  });
  it("still lets a later size or colour win", () => {
    expect(cn("text-small", "text-body")).toBe("text-body");
    expect(cn("text-foreground", "text-danger")).toBe("text-danger");
  });
});
