import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  TELEPROMPTER,
  clampSize,
  clampWpm,
  type PrompterSettings,
} from "./teleprompter";

/**
 * What the prompter remembers on this device (spec 0021, Browser storage): the speed and size
 * under `ts.prompter.<creatorId>` and the script draft under `ts.scriptDraft.<creatorId>`.
 * One key per signed in creator; nothing here leaves the device. Every access is in try and
 * catch, because storage can be blocked or full.
 */

export const settingsKey = (creatorId: string) => `ts.prompter.${creatorId}`;
export const draftKey = (creatorId: string) => `ts.scriptDraft.${creatorId}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const settingsSchema = z.object({
  wpm: z.number(),
  size: z.number(),
  follow: z.boolean().optional(),
  followDisclosed: z.boolean().optional(),
});

export function loadSettings(store: Store | null, creatorId: string): PrompterSettings {
  try {
    const raw = store?.getItem(settingsKey(creatorId));
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_SETTINGS;
    return {
      wpm: clampWpm(parsed.data.wpm),
      size: clampSize(parsed.data.size),
      follow: parsed.data.follow ?? false,
      followDisclosed: parsed.data.followDisclosed ?? false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(store: Store | null, creatorId: string, settings: PrompterSettings) {
  try {
    store?.setItem(settingsKey(creatorId), JSON.stringify(settings));
  } catch {
    // Blocked or full: the settings just are not remembered.
  }
}

export function loadDraft(store: Store | null, creatorId: string): string {
  try {
    return (store?.getItem(draftKey(creatorId)) ?? "").slice(0, TELEPROMPTER.scriptMaxChars);
  } catch {
    return "";
  }
}

export function saveDraft(store: Store | null, creatorId: string, draft: string) {
  try {
    if (draft === "") store?.removeItem(draftKey(creatorId));
    else store?.setItem(draftKey(creatorId), draft);
  } catch {
    // Not remembered.
  }
}

export function clearDraft(store: Store | null, creatorId: string) {
  try {
    store?.removeItem(draftKey(creatorId));
  } catch {
    // Nothing to clear.
  }
}

/** The browser's localStorage, or null when it cannot be reached. */
export function deviceStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
