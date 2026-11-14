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
      hash: "9fdba6ccbeefa6e7ad64e0202e47b73dc98f8c3633ff925913d04f85a2b34e44",
    },
    {
      date: "2026-11-15",
      hash: "a0476a3c6ce025261d5edd0ce926836bcf8344f047cb62209c6f6a95e861ae0c",
    },
    {
      date: "2026-11-16",
      hash: "4efda60e2682d9db237dbf505cd5b749db37a90d102c2a3ddff755bb242f0fe0",
    },
  ],
  terms: [
    {
      date: "2026-11-14",
      hash: "42a10ab98ab87d6012ecb293d76fdd889c40263396e2a5bbe05ddb828fd74995",
    },
    {
      date: "2026-11-15",
      hash: "d8cbd801c47aae66eb125831fd14e78de841f04455b82ce3f19ec68489ed7ea6",
    },
    {
      date: "2026-11-16",
      hash: "cc21c86f998d5b0a07bc08fb0bbd9d3d6b4fe992f25023f9c0a6cd7b4d09ecd1",
    },
  ],
};

/** The recorded hash for this version date, or null when none is recorded. */
export function recordedHash(page: "privacy" | "terms", date: string): string | null {
  return LEGAL_TEXT_HASHES[page].find((entry) => entry.date === date)?.hash ?? null;
}
