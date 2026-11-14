/**
 * Voice following, the pure part (spec 0021 step 2, AC-12): where in the script the creator is,
 * from the words Deepgram has heard so far. No browser, no network, no storage. A script and what
 * was heard are personal data: nothing here logs or returns text, only positions.
 */

/** How far past the last match a new match may land (words). Lets a skipped line or two through. */
export const FOLLOW_WINDOW = 30;
/** The most heard words compared at once (the end of the interim text). */
export const FOLLOW_TAIL = 4;

/** Lowercase letters and digits only: "Don't," and "dont" are the same word. */
export function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** The script as words, split on whitespace, with the same indexes the prompter counts. */
export function scriptWordsOf(script: string): readonly string[] {
  return script.split(/\s+/).filter((w) => w.length > 0);
}

/** Two words match when equal, or one letter apart for words of five letters or more (transcriber spelling). */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return a.length > 0;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  return withinOneEdit(a, b);
}

function withinOneEdit(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (short.length === long.length) return short.slice(i + 1) === long.slice(i + 1);
  return short.slice(i) === long.slice(i + 1);
}

export type FollowResult = {
  /** Index of the last script word matched so far; -1 before the first match. */
  readonly matchIndex: number;
  /** True when this call moved the position forward. */
  readonly advanced: boolean;
};

/**
 * Move the position forward when the end of what was heard lines up with the script.
 *
 * `scriptWords` are normalised script words, `heardWords` the words of the current interim result,
 * `lastMatchIndex` the last matched script index (-1 at the start). Matching only looks forward,
 * inside `FOLLOW_WINDOW` words, so a repeated line never drags the prompter back and a skipped
 * line is jumped over. Words that match nothing (ad libs) change nothing. A run of two or more
 * heard words must line up; a single heard word only counts when it is four letters or longer,
 * so "the" or "and" cannot jump the prompter.
 */
export function followScript(
  scriptWords: readonly string[],
  heardWords: readonly string[],
  lastMatchIndex: number,
): FollowResult {
  const stay: FollowResult = { matchIndex: lastMatchIndex, advanced: false };
  const heard = heardWords.map(normaliseWord).filter((w) => w.length > 0);
  if (heard.length === 0) return stay;
  const from = lastMatchIndex + 1;
  const to = Math.min(scriptWords.length - 1, lastMatchIndex + FOLLOW_WINDOW);
  for (let run = Math.min(FOLLOW_TAIL, heard.length); run >= 1; run--) {
    const tail = heard.slice(heard.length - run);
    if (run === 1 && (tail[0]?.length ?? 0) < 4) break;
    for (let end = from + run - 1; end <= to; end++) {
      const start = end - run + 1;
      if (tail.every((w, k) => wordsMatch(w, scriptWords[start + k] ?? ""))) {
        return { matchIndex: end, advanced: true };
      }
    }
  }
  return stay;
}
