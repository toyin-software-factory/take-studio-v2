/** Run settings from the environment (moved out of lighthouse-ci.ts). */
export const BASE = process.env.LH_BASE_URL ?? "http://127.0.0.1:8787";
export const RUNS = Number(process.env.LH_RUNS ?? "3");
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error(`::error::LH_RUNS must be a positive whole number, got "${process.env.LH_RUNS}".`);
  process.exit(1);
}
export const PORT = 9333;
export const OUT = "lighthouse-reports";
