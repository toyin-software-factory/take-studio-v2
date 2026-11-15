import { chargedMonth } from "@/lib/billing";

/**
 * Spec 0014 steps 2 and 3 (AC-1, AC-3 to AC-5, AC-10, AC-11). `app_setting` is global per
 * database, so this file has its own database and sets the two settings per test.
 */
export const SECRET = "x".repeat(40);
export const NOW = new Date("2026-11-10T12:00:00Z");
export const MONTH = chargedMonth(NOW);
