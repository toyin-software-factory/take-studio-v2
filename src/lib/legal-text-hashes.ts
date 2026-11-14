/**
 * Recorded hashes of the Privacy and Terms copy (spec 0015 AC-7, AC-9). The history is append only:
 * one line per change to a page's copy, oldest first, each holding the real date of the change and
 * the SHA-256 of the normalized copy it went out with. A date may repeat (two changes on one day
 * are two lines). The newest line of a page must match the live copy, and `LEGAL_VERSION` must be
 * that line's date, never after today. Never edit or delete an older line: every line after the
 * first carries `after`, a digest of the line before it (see `lineDigest` in
 * `legal-text-hashes.test.ts`), so a changed or removed line breaks the line that follows it.
 * To record a change: edit the copy, set `LEGAL_VERSION` to today, run the tests to see the new
 * hash and `after`, and append one line.
 */
export type RecordedHash = {
  readonly date: string;
  readonly hash: string;
  readonly after?: string;
};

export const LEGAL_TEXT_HASHES: Readonly<Record<"privacy" | "terms", readonly RecordedHash[]>> = {
  privacy: [
    {
      date: "2026-11-14",
      hash: "eaa6591705ef7dc7fd891fdc8bd9267b7c9a30d06aee4e06f53cdfa976b79884",
    },
    {
      date: "2026-11-14",
      hash: "e8fcf408161d4a4f1463b9a9df56efbcb6a0bfb75151f41e249ecc6f235aceac",
      after: "48253593f0e8a21c213507eef110b4c0437c050edd413320b88a8c0353d82ad3",
    },
  ],
  terms: [
    {
      date: "2026-11-14",
      hash: "cc21c86f998d5b0a07bc08fb0bbd9d3d6b4fe992f25023f9c0a6cd7b4d09ecd1",
    },
  ],
};

/** The newest recorded line of a page, or null when the history is empty. */
export function latestRecorded(page: "privacy" | "terms"): RecordedHash | null {
  return LEGAL_TEXT_HASHES[page].at(-1) ?? null;
}

/** The newest recorded hash when it is the one for this version date, otherwise null. */
export function recordedHash(page: "privacy" | "terms", date: string): string | null {
  const latest = latestRecorded(page);
  return latest?.date === date ? latest.hash : null;
}
