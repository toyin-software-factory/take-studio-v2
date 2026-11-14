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
      hash: "72eec5ee1bb7155e255d0688446f5a29b24c8216e0d627bf3d86bb39679a092a",
      after: "48253593f0e8a21c213507eef110b4c0437c050edd413320b88a8c0353d82ad3",
    },
    {
      date: "2026-11-14",
      hash: "282e1ca0a338f1decddb5d8afa8e11176e5790d739570c03e961ed56551ea293",
      after: "f4f821f9f9c6dad8f462394ed8969c2a2b206959c0055abd70600c90b9b7802d",
    },
  ],
  terms: [
    {
      date: "2026-11-14",
      hash: "cc21c86f998d5b0a07bc08fb0bbd9d3d6b4fe992f25023f9c0a6cd7b4d09ecd1",
    },
    {
      date: "2026-11-14",
      hash: "280af0e6aed037a4ec2710ed2d022ba76579114b5cba9288cc2b22e29f03a662",
      after: "8a8a80929fba6c70be1e3a27e8b3cfd56ff66a8852f619886a586ccd59ecd449",
    },
    {
      date: "2026-11-14",
      hash: "4193cbb496f98168a21fe022e892e8c05f2827555d9015e6a92f5e4abea61026",
      after: "8c918959bd19018e25e2020c6f77ddfb4114bd51e42ddec8a004d6aac0727198",
    },
    {
      date: "2026-11-14",
      hash: "280af0e6aed037a4ec2710ed2d022ba76579114b5cba9288cc2b22e29f03a662",
      after: "34d8cc6a51583d381f8c859dcca5c7496a7503d9b00d64323e5f7c51f6d5c4c2",
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
