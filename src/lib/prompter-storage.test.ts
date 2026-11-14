import { describe, expect, it } from "vitest";
import {
  clearDraft,
  draftKey,
  loadDraft,
  loadSettings,
  saveDraft,
  saveSettings,
  settingsKey,
} from "./prompter-storage";
import { DEFAULT_SETTINGS } from "./teleprompter";

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("prompter storage", () => {
  it("keeps one key per creator", () => {
    expect(settingsKey("a")).toBe("ts.prompter.a");
    expect(draftKey("a")).toBe("ts.scriptDraft.a");
  });
  it("round trips settings and ignores another creator's", () => {
    const s = memory();
    saveSettings(s, "a", { wpm: 180, size: 54 });
    expect(loadSettings(s, "a")).toEqual({ wpm: 180, size: 54 });
    expect(loadSettings(s, "b")).toEqual(DEFAULT_SETTINGS);
  });
  it("falls back on bad data and clamps values", () => {
    const s = memory();
    s.map.set(settingsKey("a"), "not json");
    expect(loadSettings(s, "a")).toEqual(DEFAULT_SETTINGS);
    s.map.set(settingsKey("a"), JSON.stringify({ wpm: 9999, size: 50 }));
    expect(loadSettings(s, "a")).toEqual({ wpm: 260, size: 54 });
    s.map.set(settingsKey("a"), JSON.stringify({ wpm: "x" }));
    expect(loadSettings(s, "a")).toEqual(DEFAULT_SETTINGS);
  });
  it("saves, loads and clears the draft", () => {
    const s = memory();
    saveDraft(s, "a", "hello");
    expect(loadDraft(s, "a")).toBe("hello");
    saveDraft(s, "a", "");
    expect(s.map.size).toBe(0);
    saveDraft(s, "a", "again");
    clearDraft(s, "a");
    expect(loadDraft(s, "a")).toBe("");
  });
  it("never throws when storage is blocked", () => {
    expect(loadSettings(broken, "a")).toEqual(DEFAULT_SETTINGS);
    expect(loadDraft(broken, "a")).toBe("");
    expect(() => saveSettings(broken, "a", DEFAULT_SETTINGS)).not.toThrow();
    expect(() => saveDraft(broken, "a", "x")).not.toThrow();
    expect(() => clearDraft(broken, "a")).not.toThrow();
    expect(loadSettings(null, "a")).toEqual(DEFAULT_SETTINGS);
  });
});
