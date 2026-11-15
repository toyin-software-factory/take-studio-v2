/** The output frame rate argument: the source's average, rounded to 3 decimals (CFR). */
export function outputFps(fps: number | null): string {
  return String(Math.round((fps ?? 30) * 1000) / 1000);
}

/** `out_time_us` (or `out_time_ms`, which is also µs) from an ffmpeg `-progress` chunk, in ms. */
export function progressOutTimeMs(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  const last = matches.at(-1)?.[1];
  return last === undefined ? null : Math.floor(Number(last) / 1000);
}

/**
 * A progress reporter that writes at most every `minIntervalMs` and only when the value moved
 * by at least `minDelta` points (spec 0004 Flow step 6). `flush` writes the last value.
 */
export function throttledProgress(
  write: (percent: number) => Promise<unknown>,
  options: {
    readonly minIntervalMs?: number;
    readonly minDelta?: number;
    readonly now?: () => number;
  } = {},
) {
  const minIntervalMs = options.minIntervalMs ?? 2_000;
  const minDelta = options.minDelta ?? 1;
  const now = options.now ?? Date.now;
  let lastWritten = -1;
  let lastAt = -Infinity;
  let pending: number | null = null;
  // Progress is best effort: a failed write must never fail the job or leave a rejection
  // behind. Writes run one after another, so an older value can never overwrite a newer one,
  // and `flush` waits for every write still in flight.
  let chain: Promise<void> = Promise.resolve();
  const safeWrite = (percent: number): Promise<void> => {
    chain = chain.then(async () => {
      try {
        await write(percent);
      } catch {
        // The next report or the final step write will carry the state.
      }
    });
    return chain;
  };
  return {
    async report(percent: number): Promise<void> {
      const value = Math.max(0, Math.min(100, Math.floor(percent)));
      pending = value;
      if (value - lastWritten < minDelta || now() - lastAt < minIntervalMs) return;
      lastWritten = value;
      lastAt = now();
      pending = null;
      await safeWrite(value);
    },
    async flush(): Promise<void> {
      if (pending !== null && pending !== lastWritten) {
        lastWritten = pending;
        pending = null;
        await safeWrite(lastWritten);
      }
      await chain;
    },
  };
}
