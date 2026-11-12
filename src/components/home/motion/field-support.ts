/**
 * When the studio floor's particle field may run (spec 0010, AC-6), and how big it is. Pure, so
 * it is unit tested; `studio.ts` reads the browser and asks it before the Three.js chunk is
 * even requested. When the answer is no, the page keeps the CSS glow behind the section.
 */
export type FieldSupport =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "save-data" | "low-memory" | "no-webgl" };

/** Under this much device memory (GB, as `navigator.deviceMemory` reports it) no WebGL is drawn. */
export const MIN_DEVICE_MEMORY_GB = 4;

export function fieldSupport(env: {
  /** `navigator.connection?.saveData`. */
  readonly saveData: boolean | undefined;
  /** `navigator.deviceMemory`: undefined where the browser does not say (then allowed). */
  readonly deviceMemory: number | undefined;
  /** A WebGL context could be created. */
  readonly webgl: boolean;
}): FieldSupport {
  if (env.saveData) return { ok: false, reason: "save-data" };
  if (env.deviceMemory !== undefined && env.deviceMemory < MIN_DEVICE_MEMORY_GB) {
    return { ok: false, reason: "low-memory" };
  }
  if (!env.webgl) return { ok: false, reason: "no-webgl" };
  return { ok: true };
}

/** The most points drawn: 24,000 on desktop, 8,000 under 810 px (spec 0010, design.md 7.7). */
export const FIELD_POINTS = { desktop: 24_000, mobile: 8_000 } as const;

/** The widest pixel ratio the field renders at. */
export const FIELD_MAX_PIXEL_RATIO = 1.5;

export const fieldPointCount = (viewportWidth: number): number =>
  viewportWidth < 810 ? FIELD_POINTS.mobile : FIELD_POINTS.desktop;

export const fieldPixelRatio = (devicePixelRatio: number): number =>
  Math.min(devicePixelRatio, FIELD_MAX_PIXEL_RATIO);
