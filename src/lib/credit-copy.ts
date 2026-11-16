/** What the take page says about the "Edited with Take Studio" credit (spec 0026 AC-8). */

export const CREDIT_LINE = "Free videos end with an Edited with Take Studio credit.";
export const CREDIT_PAID_LINE = "Paid plans can remove it.";

/**
 * The line near Download, from what the stored finished video really has. A video with no credit
 * (older, handed back as is, or paid) gets no line, and no text promises a paid plan unless
 * `paidRemoval` is true (billing on and the paid switch live, so it is never true yet).
 */
export function creditNote(
  credit: { readonly applied: boolean; readonly canChange: boolean },
  paidRemoval: boolean,
): { readonly text: string; readonly paid: string | null } | null {
  if (!credit.applied || credit.canChange) return null;
  return { text: CREDIT_LINE, paid: paidRemoval ? CREDIT_PAID_LINE : null };
}
