import { eq } from "drizzle-orm";
import type { Tx } from "@/db/types";
import { take } from "@/db/schema";
import { ok } from "@/lib/result";

/**
 * Stores the take's waveform (spec 0011, AC-11): integers 0 to 100, 1 to 1000 of them, over the
 * original, so a repeat on a retry or a second job writes the same thing. Call it inside
 * `whileJobActive` so a finished job writes nothing. The values are personal data in a weak
 * sense (the shape of the voice): never log them.
 */
export async function saveWaveform(
  tx: Tx,
  input: { readonly takeId: string; readonly waveform: readonly number[] },
) {
  await tx.update(take).set({ waveform: input.waveform }).where(eq(take.id, input.takeId));
  return ok(null);
}
