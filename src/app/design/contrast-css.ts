import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Reads colour tokens straight from the CSS parts (B2-T139): no hard coded copies. Test support only. */
export type Rgb = readonly [number, number, number];
export type Colour = { readonly rgb: Rgb; readonly alpha: number };

const STYLES = join(__dirname, "..", "styles");
const declared = new Map<string, string>();
for (const part of ["theme", "root"]) {
  const css = readFileSync(join(STYLES, `${part}.css`), "utf8");
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    if (!declared.has(m[1]!)) declared.set(m[1]!, m[2]!.trim());
  }
}

/** Every `--color-*` token the CSS declares with a literal colour (hex or rgb). */
export const colourTokenNames = (): string[] =>
  [...declared]
    .filter(([name, value]) => name.startsWith("--color-") && /^(#|rgb)/i.test(value))
    .map(([name]) => name.slice(2));

/** Parses `#rrggbb` or `rgb(r g b / a%)` (also with commas). */
export function parseColour(value: string): Colour {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex)
    return { rgb: [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)], alpha: 1 };
  const fn =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%)?)?\s*\)$/i.exec(value);
  if (!fn) throw new Error(`Not a colour: ${value}`);
  const a = fn[4] === undefined ? 1 : fn[5] ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
  return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alpha: a };
}

/** The colour of a token such as `color-nav-glass-light`, from the CSS source. */
export function tokenColour(name: string): Colour {
  const value = declared.get(`--${name}`);
  if (value === undefined) throw new Error(`No CSS token --${name}`);
  return parseColour(value);
}

/** `top over under`, channel by channel. */
export const over = (top: Colour, under: Rgb): Rgb =>
  top.rgb.map((v, i) => top.alpha * v + (1 - top.alpha) * under[i]!) as unknown as Rgb;

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
