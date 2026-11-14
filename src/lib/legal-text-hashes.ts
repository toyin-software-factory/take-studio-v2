/**
 * Recorded hashes of the Privacy and Terms copy (spec 0015 AC-7, AC-9). One line per version:
 * the date from `LEGAL_VERSION` and the SHA-256 of the normalized copy that date went out with.
 * A change to the copy changes its hash, which is not recorded, so the test fails; adding a line
 * with the same date fails too (a date appears once), so the only way through is a new date.
 * Never edit a recorded line; add a new one under the new date.
 */
export type RecordedHash = { readonly date: string; readonly hash: string };

export const LEGAL_TEXT_HASHES: Readonly<Record<"privacy" | "terms", readonly RecordedHash[]>> = {
  privacy: [
    {
      date: "2026-11-14",
      hash: "eaa6591705ef7dc7fd891fdc8bd9267b7c9a30d06aee4e06f53cdfa976b79884",
    },
  ],
  terms: [
    {
      date: "2026-11-14",
      hash: "cc21c86f998d5b0a07bc08fb0bbd9d3d6b4fe992f25023f9c0a6cd7b4d09ecd1",
    },
  ],
};

/** The recorded hash for this version date, or null when none is recorded. */
export function recordedHash(page: "privacy" | "terms", date: string): string | null {
  return LEGAL_TEXT_HASHES[page].find((entry) => entry.date === date)?.hash ?? null;
}
