/**
 * The take's waveform (spec 0011, AC-11): at most 1000 integers from 0 to 100, evenly spaced
 * over the original's length, drawn under the cut timeline. Pure: the ffmpeg pass that makes
 * the samples lives in `src/trigger/waveform.ts`.
 */

export const WAVEFORM = {
  /** Most values stored. */
  maxBuckets: 1000,
  /** One value per this many milliseconds, until the cap. */
  bucketMs: 100,
  /** Sample rate of the ffmpeg pass (mono). */
  sampleRate: 8000,
  /** Quietest level shown: RMS at or below this is 0 (absolute dBFS). */
  floorDb: -60,
} as const;

/** Number of values for a take of this length: `min(1000, ceil(durationMs / 100))`, at least 1. */
export function waveformBuckets(durationMs: number): number {
  return Math.max(1, Math.min(WAVEFORM.maxBuckets, Math.ceil(durationMs / WAVEFORM.bucketMs)));
}

/** One bucket's RMS (samples scaled to -1..1) to 0..100: a -60 dB floor, 0 dB is 100. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const scaled = (20 * Math.log10(rms) - WAVEFORM.floorDb) / -WAVEFORM.floorDb;
  return Math.round(100 * Math.min(1, Math.max(0, scaled)));
}

/**
 * Buckets mono samples (scaled to -1..1) into `waveformBuckets(durationMs)` levels. Sample `i`
 * goes to bucket `floor(i * n / length)`, so the buckets cover the whole take evenly. No samples
 * (no audio) or no length gives null.
 */
export function waveformFromSamples(
  samples: ArrayLike<number>,
  durationMs: number,
): readonly number[] | null {
  const length = samples.length;
  if (length === 0 || !(durationMs > 0)) return null;
  const n = waveformBuckets(durationMs);
  const sums = new Float64Array(n);
  const counts = new Uint32Array(n);
  for (let i = 0; i < length; i++) {
    const bucket = Math.min(n - 1, Math.floor((i * n) / length));
    const s = samples[i] ?? 0;
    sums[bucket] = (sums[bucket] ?? 0) + s * s;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return Array.from(sums, (sum, b) => {
    const count = counts[b] ?? 0;
    return count === 0 ? 0 : levelFromRms(Math.sqrt(sum / count));
  });
}

/**
 * Makes the samples cover exactly the take's length: audio that ends before the video is padded
 * with silence and audio that runs past it is cut, so a sound keeps its place on the video
 * timeline. No samples stays empty (no audio).
 */
export function alignSamples(samples: Float32Array, durationMs: number): Float32Array {
  if (samples.length === 0 || !(durationMs > 0)) return samples;
  const want = Math.round((durationMs * WAVEFORM.sampleRate) / 1000);
  if (samples.length === want) return samples;
  if (samples.length > want) return samples.subarray(0, want);
  const out = new Float32Array(want);
  out.set(samples);
  return out;
}

/** Raw signed 16 bit little endian PCM (ffmpeg `-f s16le`) to samples scaled to -1..1. */
export function samplesFromPcm16(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
