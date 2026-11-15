import { describe, expect, it } from "vitest";
import { createWriteGuard } from "./take-poll-guard";

describe("a poll reply that started before a write (B2-T144)", () => {
  it("is stale once the page has written since the poll began", () => {
    const guard = createWriteGuard();
    const ticket = guard.begin();
    guard.noteWrite();
    expect(guard.isStale(ticket)).toBe(true);
  });

  it("is fresh when no write happened while it was in flight", () => {
    const guard = createWriteGuard();
    const ticket = guard.begin();
    expect(guard.isStale(ticket)).toBe(false);
  });

  it("a poll that begins after the write is fresh, the one before it stays stale", () => {
    const guard = createWriteGuard();
    const before = guard.begin();
    guard.noteWrite();
    const after = guard.begin();
    expect(guard.isStale(before)).toBe(true);
    expect(guard.isStale(after)).toBe(false);
  });

  it("keeps every older poll stale across several writes", () => {
    const guard = createWriteGuard();
    const first = guard.begin();
    guard.noteWrite();
    guard.noteWrite();
    expect(guard.isStale(first)).toBe(true);
  });

  it("applies a reply only when fresh, so a slow poll cannot put the old title back", () => {
    const guard = createWriteGuard();
    let title = "Founder intro";
    const ticket = guard.begin(); // the poll asks while the title is still the old one
    title = "Founder intro, final"; // the rename is saved
    guard.noteWrite();
    const apply = (reply: string) => {
      if (!guard.isStale(ticket)) title = reply;
    };
    apply("Founder intro"); // the old reply lands late
    expect(title).toBe("Founder intro, final");
  });
});
