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
    {
      date: "2026-11-14",
      hash: "b5461a049a5f2ad5af31a804b9c81e715f8af95bb77a7c08748b08e550470f9c",
      after: "caadbbb50fe758ca7501719c3831bba9abedb0babac3624f430b27748b122ff2",
    },
    {
      date: "2026-11-14",
      hash: "91cded7271ed2c9071bd210a7e1e41f3bed3218c39cdc3f56090d97cef0c7e56",
      after: "13e995439469c86d17c3b9ec6db0d4d8d365b2b51eba2e958036ce240756b421",
    },
    {
      date: "2026-11-14",
      hash: "970f6abe00b0c58cfacb5c03e82673e2bd57cb0edb8bcd6920182f9d05dc1dfc",
      after: "41233760000262cfc4d03814f33c0889377991dee307ffffdec733de54cbc79d",
    },
    {
      date: "2026-11-14",
      hash: "36e01d09622233cd695d4b6b123f5109874029591ef51f3baf0b3c713075daf6",
      after: "d2a0534ec076cbb1bc9ee422b14cf68d800313f32c68c9bc72b99d4fc138cb74",
    },
    {
      date: "2026-11-14",
      hash: "cc8b0807242b53a9359bab6448a82361c59dd15c19ae1f4f3fca3c1b43cb74e4",
      after: "19631d3d77737edbbb2be5b4d70930aeef56a77024568d3acf460fc9838d32ba",
    },
    {
      date: "2026-11-14",
      hash: "d7e97f5b9725cfe05b7629f1165c69c2b4be46ce6a06c2a8a13b997a8e98a5c9",
      after: "c9f6fd80e9590f48c5dd1a5ffa8a86eab7bc801df00d8462b2773a542cc7dc4d",
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
    {
      date: "2026-11-14",
      hash: "5da07428f861f18db40faef37b04e91aff94f80c20bbd333cc567b578cff70fb",
      after: "001c92aa9b33ad2e6cbc1e9bd381472c659ce24fbb7d4675ccd6ea01c5716fea",
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
