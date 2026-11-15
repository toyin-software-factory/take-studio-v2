export const NOW = new Date("2026-11-11T12:00:00Z");
export const minutes = (n: number) => new Date(NOW.getTime() - n * 60 * 1000);
/** Storage that has no object: an upload that never completed. */
export const notStored = async () => null;
