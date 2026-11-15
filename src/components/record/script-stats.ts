/** Words in a script: runs of non space characters. */
export function countWords(script: string): number {
  const trimmed = script.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** "m:ss" for a number of seconds, rounded to the nearest second. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** How long a script of `words` takes to read at `wpm`, as the meta line says it. */
export function readingTime(words: number, wpm: number): string {
  if (words <= 0) return "No script: just talk";
  return `about ${clock((words / wpm) * 60)} at ${wpm} wpm`;
}

/** "1,234 / 20,000", the counter above the script. */
export function charCount(length: number, max: number): string {
  return `${length.toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")}`;
}
