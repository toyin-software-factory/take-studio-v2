import { blend, type PairKind, type Rgba } from "./contrast";

/**
 * The tokens the /design gallery shows, as data. The values mirror `src/app/globals.css` and
 * design.md §2 (a unit test keeps all three in sync); swatches paint with `var(--name)`, never
 * these values. `name` is the CSS variable without the leading `--`.
 */

export type ColourToken = {
  readonly name: string;
  /** What globals.css and design.md §2 say, for display. */
  readonly value: string;
  readonly use: string;
  /** `#rrggbb` for an opaque token, used for the contrast maths. */
  readonly hex?: string;
  /** Translucent tokens: red, green, blue, alpha. Flattened over the background of a pair. */
  readonly rgba?: Rgba;
};

export type ContrastPair = {
  readonly fg: string;
  readonly bg: string;
  readonly kind: PairKind;
};

export const shellColours: readonly ColourToken[] = [
  { name: "color-bg", value: "#ffffff", hex: "#ffffff", use: "Page, cards, dialogs, inputs" },
  { name: "color-surface", value: "#f6f6f6", hex: "#f6f6f6", use: "Panels and tiles" },
  { name: "color-ink", value: "#030303", hex: "#030303", use: "Text, primary buttons, focus" },
  { name: "color-ink-soft", value: "#252528", hex: "#252528", use: "Primary hover" },
  { name: "color-text-muted", value: "#4f4f4f", hex: "#4f4f4f", use: "Muted text on white" },
  { name: "color-line", value: "#d2cdd8", hex: "#d2cdd8", use: "Hairlines (decorative)" },
  { name: "color-line-strong", value: "#767676", hex: "#767676", use: "Form borders (3:1)" },
  { name: "color-hairline", value: "rgba(0, 0, 0, 0.08)", rgba: [0, 0, 0, 0.08], use: "Rings" },
];

export const darkColours: readonly ColourToken[] = [
  { name: "color-dark", value: "#010101", hex: "#010101", use: "Stage panel, footer" },
  { name: "color-dark-2", value: "#0f0f0f", hex: "#0f0f0f", use: "Raised panels on the stage" },
  { name: "color-on-dark", value: "#ffffff", hex: "#ffffff", use: "Text on the stage" },
  {
    name: "color-on-dark-75",
    value: "rgba(255, 255, 255, 0.75)",
    rgba: [255, 255, 255, 0.75],
    use: "Body on dark",
  },
  {
    name: "color-on-dark-60",
    value: "rgba(255, 255, 255, 0.6)",
    rgba: [255, 255, 255, 0.6],
    use: "Meta on dark, strong borders",
  },
  {
    name: "color-on-dark-20",
    value: "rgba(255, 255, 255, 0.2)",
    rgba: [255, 255, 255, 0.2],
    use: "Borders (decorative)",
  },
  {
    name: "color-line-dark",
    value: "rgba(255, 255, 255, 0.1)",
    rgba: [255, 255, 255, 0.1],
    use: "Hairlines on dark",
  },
  {
    name: "color-glass",
    value: "rgba(0, 0, 0, 0.3)",
    rgba: [0, 0, 0, 0.3],
    use: "Glass buttons and transport bar",
  },
];

export const accentColours: readonly ColourToken[] = [
  {
    name: "color-accent",
    value: "#cdff59",
    hex: "#cdff59",
    use: "Focus on dark, fills; never text on white",
  },
  { name: "color-success", value: "#2e6b3f", hex: "#2e6b3f", use: "Success label and icon" },
  { name: "color-warning", value: "#8a5a00", hex: "#8a5a00", use: "Warning label and icon" },
  { name: "color-error", value: "#9b0d18", hex: "#9b0d18", use: "Error label and icon" },
];

export const lightColours: readonly ColourToken[] = [...shellColours, ...accentColours];
export const stageColours: readonly ColourToken[] = darkColours;
export const allColours: readonly ColourToken[] = [...lightColours, ...stageColours];

/** The ratio for a pair: a translucent colour is flattened over the pair's background first. */
export function pairHexes(pair: ContrastPair): { readonly fg: string; readonly bg: string } {
  const find = (name: string): ColourToken => {
    const token = allColours.find((t) => t.name === name);
    if (!token) throw new Error(`No colour token named ${name}`);
    return token;
  };
  const bgToken = find(pair.bg);
  if (!bgToken.hex) throw new Error(`${pair.bg} is translucent, so it cannot be a background`);
  const fgToken = find(pair.fg);
  const fg = fgToken.hex ?? blend(fgToken.rgba!, bgToken.hex);
  return { fg, bg: bgToken.hex };
}

const on = (fgs: readonly string[], bgs: readonly string[], kind: PairKind): ContrastPair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, kind })));

/** Every colour pair design.md relies on, by token name. */
export const lightPairs: readonly ContrastPair[] = [
  ...on(
    ["color-ink", "color-text-muted", "color-success", "color-warning", "color-error"],
    ["color-bg", "color-surface"],
    "text",
  ),
  ...on(["color-on-dark"], ["color-ink", "color-ink-soft"], "text"),
  ...on(["color-ink"], ["color-accent"], "text"),
  ...on(["color-line-strong", "color-ink"], ["color-bg", "color-surface"], "ui"),
  ...on(["color-line"], ["color-bg"], "decorative"),
];

export const stagePairs: readonly ContrastPair[] = [
  ...on(
    ["color-on-dark", "color-on-dark-75", "color-on-dark-60"],
    ["color-dark", "color-dark-2"],
    "text",
  ),
  ...on(["color-accent", "color-on-dark-60"], ["color-dark", "color-dark-2"], "ui"),
  ...on(["color-on-dark-20", "color-line-dark"], ["color-dark", "color-dark-2"], "decorative"),
];

export const typeScale = [
  {
    name: "display-xl",
    className: "text-display-xl",
    size: "66 to 232 px",
    note: "One giant word",
    sample: "Take",
  },
  {
    name: "display",
    className: "text-display",
    size: "56 to 96 px",
    note: "Stat numbers",
    sample: "01:23",
  },
  { name: "h1", className: "text-h1", size: "44 to 56 px", note: "Page title" },
  { name: "h2", className: "text-h2", size: "36 to 56 px", note: "Section" },
  { name: "h3", className: "text-h3", size: "24 to 32 px", note: "Card title" },
  { name: "h4", className: "text-h4", size: "20 to 26 px", note: "Panel title" },
  { name: "lead", className: "text-lead", size: "18 to 20 px, 300", note: "Intro paragraph" },
  { name: "body", className: "text-body", size: "16 px, 300", note: "Default text" },
  { name: "small", className: "text-small", size: "14 px, 400", note: "Helper text" },
  { name: "caption", className: "text-caption", size: "12 px, 400", note: "Chips, labels" },
] as const satisfies readonly {
  readonly name: string;
  readonly className: string;
  readonly size: string;
  readonly note: string;
  readonly sample?: string;
}[];

/** Full class names so Tailwind finds them when scanning this file. */
export const spacingScale = [
  { px: 4, className: "w-1" },
  { px: 8, className: "w-2" },
  { px: 12, className: "w-3" },
  { px: 16, className: "w-4" },
  { px: 24, className: "w-6" },
  { px: 32, className: "w-8" },
  { px: 48, className: "w-12" },
  { px: 64, className: "w-16" },
] as const;

export const radii = [
  { name: "Tiny parts (radius-xs)", className: "rounded-xs", value: "5 px" },
  { name: "Swatches, small tiles (radius-sm)", className: "rounded-sm", value: "8 px" },
  { name: "Images, panels, inputs (radius-md)", className: "rounded-md", value: "10 px" },
  { name: "Glass cards, dialogs (radius-lg)", className: "rounded-lg", value: "12 px" },
  { name: "Buttons, chips, tabs (radius-pill)", className: "rounded-full", value: "999 px" },
] as const;

export const shadows = [
  { name: "Cards (ring-light)", className: "shadow-card" },
  { name: "Menus, dialogs, toasts (shadow-lift)", className: "shadow-lift" },
  { name: "Fan card, homepage only (shadow-fan)", className: "shadow-fan" },
] as const;

export const layers = [
  ["field", 0],
  ["base", 1],
  ["raised", 10],
  ["edge-blur", 50],
  ["nav", 100],
  ["menu", 200],
  ["cursor", 900],
  ["modal", 1000],
] as const;
