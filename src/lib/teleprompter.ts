/**
 * Teleprompter rules (spec 0021 task 2, AC-2 and AC-9). Pure: the position is counted in words
 * passed, so a speed change only affects what comes after it and the prompter never jumps.
 */

/** Teleprompter settings (spec 0021, Configuration). */
export const TELEPROMPTER = {
  wpmMin: 60,
  wpmMax: 260,
  wpmStep: 10,
  wpmDefault: 140,
  sizes: [28, 36, 44, 54, 64],
  sizeDefault: 44,
  scriptMaxChars: 20_000,
  followFallbackMs: 5000,
} as const;

export type PrompterSettings = {
  readonly wpm: number;
  readonly size: number;
};

export const DEFAULT_SETTINGS: PrompterSettings = {
  wpm: TELEPROMPTER.wpmDefault,
  size: TELEPROMPTER.sizeDefault,
};

/** Words in a script. */
export function countWords(script: string): number {
  const words = script.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/** A line of the script with the word number it starts at. */
export type ScriptLine = {
  readonly text: string;
  readonly startWord: number;
  readonly words: number;
};

/**
 * Splits the script into lines at line breaks, dropping blank lines, so the reduced motion
 * mode can step line by line. A very long line is cut into pieces of about `maxWords` words.
 */
export function splitLines(script: string, maxWords = 12): readonly ScriptLine[] {
  const lines: ScriptLine[] = [];
  let start = 0;
  for (const raw of script.split(/\r?\n/)) {
    const words = raw
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "");
    for (let i = 0; i < words.length; i += maxWords) {
      const piece = words.slice(i, i + maxWords);
      lines.push({ text: piece.join(" "), startWord: start, words: piece.length });
      start += piece.length;
    }
  }
  return lines;
}

/** The speed in force, clamped to the allowed range and rounded to a step. */
export function clampWpm(wpm: number): number {
  const { wpmMin, wpmMax, wpmStep } = TELEPROMPTER;
  if (!Number.isFinite(wpm)) return TELEPROMPTER.wpmDefault;
  const stepped = Math.round(wpm / wpmStep) * wpmStep;
  return Math.min(wpmMax, Math.max(wpmMin, stepped));
}

/** One step faster (+1) or slower (-1), staying inside the range. */
export function stepWpm(wpm: number, direction: 1 | -1): number {
  return clampWpm(clampWpm(wpm) + direction * TELEPROMPTER.wpmStep);
}

/** The nearest allowed text size to `size`. */
export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return TELEPROMPTER.sizeDefault;
  return TELEPROMPTER.sizes.reduce((best, s) =>
    Math.abs(s - size) < Math.abs(best - size) ? s : best,
  );
}

/** One size larger (+1) or smaller (-1), staying inside the list. */
export function stepSize(size: number, direction: 1 | -1): number {
  const sizes = TELEPROMPTER.sizes;
  const index = sizes.indexOf(clampSize(size) as (typeof sizes)[number]);
  return sizes[Math.min(sizes.length - 1, Math.max(0, index + direction))] ?? size;
}

/**
 * The position after `deltaMs` at `wpm`, in words passed, clamped to `[position, totalWords]`.
 * Time adds nothing while paused (the caller passes 0), and it never moves backwards.
 */
export function advance(
  position: number,
  deltaMs: number,
  wpm: number,
  totalWords: number,
): number {
  const start = Math.min(Math.max(0, position), Math.max(0, totalWords));
  if (!(deltaMs > 0) || !(wpm > 0)) return start;
  return Math.min(totalWords, start + (deltaMs / 60_000) * wpm);
}

/** The position after `elapsedMs` at one steady speed: a pure function of time and speed. */
export function positionAt(elapsedMs: number, wpm: number, totalWords: number): number {
  return advance(0, elapsedMs, wpm, totalWords);
}

/** Index of the line holding the word at `position`; the last line once the end is reached. */
export function lineAt(lines: readonly ScriptLine[], position: number): number {
  if (lines.length === 0) return 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= (lines[i]?.startWord ?? 0)) return i;
  }
  return 0;
}

/** How far through the script, 0 to 1. An empty script stays at 0. */
export function progress(position: number, totalWords: number): number {
  return totalWords <= 0 ? 0 : Math.min(1, Math.max(0, position / totalWords));
}

/** Keys the prompter listens to; null for anything else. */
export type PrompterCommand = "toggle" | "faster" | "slower" | "larger" | "smaller";

/**
 * Maps a key to a command. Never fires while a text field has focus (AC-9), or with a
 * modifier held, so browser shortcuts keep working.
 */
export function commandForKey(
  key: string,
  target: { readonly tagName?: string; readonly isContentEditable?: boolean } | null,
  modifiers: { readonly ctrl: boolean; readonly alt: boolean; readonly meta: boolean },
): PrompterCommand | null {
  if (modifiers.ctrl || modifiers.alt || modifiers.meta) return null;
  const tag = target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
    return null;
  }
  switch (key) {
    case "p":
    case "P":
      return "toggle";
    case "ArrowUp":
      return "faster";
    case "ArrowDown":
      return "slower";
    case "+":
    case "=":
      return "larger";
    case "-":
    case "_":
      return "smaller";
    default:
      return null;
  }
}
