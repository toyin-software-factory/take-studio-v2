/**
 * B2-T144: a poll of the take page must not undo something the page has just saved. A reply that
 * was asked for before a write (a rename, a retry) describes the take as it was, so when it lands
 * after the write it is dropped; the next poll, which starts after the write, brings the truth.
 *
 * `begin` is called when a poll sends its request, `noteWrite` when the page has changed the take
 * itself, and `isStale` when the reply arrives. Small on purpose: one counter, no timers.
 */
export type WriteGuard = {
  readonly begin: () => number;
  readonly noteWrite: () => void;
  readonly isStale: (ticket: number) => boolean;
};

export function createWriteGuard(): WriteGuard {
  let writes = 0;
  return {
    begin: () => writes,
    noteWrite: () => {
      writes += 1;
    },
    isStale: (ticket) => ticket !== writes,
  };
}
