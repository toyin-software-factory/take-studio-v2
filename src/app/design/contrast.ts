/** WCAG 2 contrast maths for opaque `#rrggbb` colours. Pure functions, no DOM. */

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a `#rrggbb` colour (0 for black, 1 for white). */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => channel(parseInt(part, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** What a pair must reach: body text 4.5:1, large text and UI graphics 3:1, decorative none. */
export type PairKind = "text" | "ui" | "decorative";

export const minimumRatio: Readonly<Record<PairKind, number>> = {
  text: 4.5,
  ui: 3,
  decorative: 1,
};

/** True when the pair meets WCAG AA for its kind. */
export function meetsAA(ratio: number, kind: PairKind): boolean {
  return ratio >= minimumRatio[kind];
}

/** A colour as the gallery knows it: opaque `#rrggbb`, or red, green, blue and alpha (0 to 1). */
export type Rgba = readonly [number, number, number, number];

const toHex = (parts: readonly number[]): string =>
  `#${parts.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Flattens a translucent colour over an opaque `#rrggbb` background, giving `#rrggbb`. */
export function blend(fg: Rgba, bgHex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bgHex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${bgHex}`);
  const bg = match.slice(1).map((part) => parseInt(part, 16));
  const [r, g, b, a] = fg;
  return toHex([r, g, b].map((v, i) => v * a + bg[i]! * (1 - a)));
}
