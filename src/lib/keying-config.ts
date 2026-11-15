/** The keying settings and colour maths (spec 0008). Pure. */

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** A decoded frame: `width * height` pixels as `r g b` bytes, row by row. */
export type RawFrame = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/**
 * The detection rule (spec 0008, Rationale): sample frames after the same HDR to SDR tone map
 * the render uses, measure patches along the left, right and top edges, and call the take
 * usable when most patches are green in most frames. Heuristics, tuned with fixtures.
 */
export const DETECTION = {
  /** Where in the take the frames are sampled (fractions of its length). */
  sampleFractions: [0.1, 0.3, 0.5, 0.7, 0.9],
  /** Each patch is this fraction of the frame's width and of its height. */
  patchFraction: 0.04,
  /** A patch is green when its median HSV is in these ranges. */
  hueMinDeg: 80,
  hueMaxDeg: 160,
  minSaturation: 0.2,
  minValue: 0.25,
  /** Usable when at least this many of the 16 patches are green ... */
  minGreenPatches: 10,
  /** ... in at least this many of the sampled frames. */
  minGreenFrames: 3,
  /** Width the sampled frames are scaled to before measuring (the patches are 4 % of it). */
  frameWidth: 320,
} as const;

/**
 * Chroma key settings, tuned with the fixtures (spec 0008 build step 1) and made adaptive in
 * S3S-T10. `similarity` and `blend` are the ceilings, right for a saturated chroma green. ffmpeg's
 * `chromakey` compares only the U and V planes, so a pale or dark green sits close to neutral in
 * UV, and a grey sweater, skin or dark clothing sit inside a fixed 0.12 + 0.08 window and are
 * keyed out with the screen. `keySettings` therefore scales both with the key colour's own
 * distance from neutral, and a key too close to neutral (below `minChroma`) is not used at all.
 */
export const KEYING = {
  similarity: 0.12,
  blend: 0.08,
  /** Similarity is at most this share of the key's distance from neutral (UV, chromakey units). */
  similarityPerChroma: 0.3,
  /** Blend is at most this share of it. */
  blendPerChroma: 0.22,
  /** A key colour closer to neutral than this cannot be told from grey and skin: no green screen. */
  minChroma: 0.12,
  /** A key that would make more of the frame transparent than this erases the subject too. */
  maxKeyedShare: 0.85,
} as const;

/**
 * How far a colour is from neutral in the U and V planes, in the units `chromakey`'s similarity
 * uses (0 neutral, about 0.5 for a pure saturated colour). It uses the same BT.601 integer
 * formula as ffmpeg's `chromakey` does for its key colour.
 */
export function keyChroma({ r, g, b }: Rgb): number {
  const u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
  const v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
  return Math.hypot(u - 128, v - 128) / (128 * Math.SQRT2);
}

/** The `chromakey` similarity and blend for a key colour: the ceilings, scaled down for a pale or dark green. */
export function keySettings(key: Rgb): { readonly similarity: number; readonly blend: number } {
  const chroma = keyChroma(key);
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    similarity: round(Math.min(KEYING.similarity, KEYING.similarityPerChroma * chroma)),
    blend: round(Math.min(KEYING.blend, KEYING.blendPerChroma * chroma)),
  };
}

/** True when the key colour is far enough from neutral to separate the screen from the subject. */
export function isKeyable(key: Rgb): boolean {
  return keyChroma(key) >= KEYING.minChroma;
}

/** The share (0 to 1) of an 8 bit alpha plane that is transparent (below half). */
export function transparentShare(alpha: Uint8Array): number {
  if (alpha.length === 0) return 1;
  let transparent = 0;
  for (const a of alpha) if (a < 128) transparent += 1;
  return transparent / alpha.length;
}

/** True when keying would remove so much of the frame that the subject must be gone too. */
export function erasesSubject(share: number): boolean {
  return share > KEYING.maxKeyedShare;
}
