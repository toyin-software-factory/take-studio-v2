import type { PairKind } from "./contrast";

/**
 * The tokens the /design gallery shows, as data. The values mirror `src/app/globals.css`
 * (a unit test keeps them in sync); swatches paint with `var(--name)`, never these values.
 */

export type ColourToken = {
  readonly name: string;
  /** `#rrggbb` for opaque tokens, or how a translucent token is mixed. */
  readonly value: string;
  readonly use: string;
};

export type ContrastPair = {
  readonly fg: string;
  readonly bg: string;
  readonly kind: PairKind;
};

export const lightColours: readonly ColourToken[] = [
  { name: "bg", value: "#fdf0d5", use: "Page background" },
  { name: "surface", value: "#ffffff", use: "Cards, dialogs, menus, inputs" },
  { name: "hover-surface", value: "Deep Space Blue 6%", use: "Hovered rows, ghost buttons" },
  { name: "selected-surface", value: "Brick Red 8%", use: "Active nav item, selected rows" },
  { name: "text", value: "#003049", use: "Body and headings" },
  { name: "text-muted", value: "#4c6a73", use: "Secondary text, placeholders" },
  { name: "border", value: "#b1b6ab", use: "Dividers only (decorative)" },
  { name: "border-strong", value: "#728688", use: "Input and control borders" },
  { name: "primary", value: "#c1121f", use: "Main buttons, links, selection" },
  { name: "primary-fg", value: "#ffffff", use: "Text on primary" },
  { name: "primary-hover", value: "#780000", use: "Primary hover" },
  { name: "primary-active", value: "#5a0000", use: "Primary pressed" },
  { name: "danger", value: "#9b0d18", use: "Errors, destructive buttons" },
  { name: "danger-hover", value: "#780000", use: "Destructive hover" },
  { name: "danger-active", value: "#5a0000", use: "Destructive pressed (light and stage)" },
  { name: "danger-bg", value: "Error red 8%", use: "Inline error alerts" },
  { name: "success", value: "#2e6b3f", use: "Success label and icon" },
  { name: "success-bg", value: "Green 8%", use: "Success alerts" },
  { name: "warning", value: "#8a5a00", use: "Warning label and icon" },
  { name: "warning-bg", value: "Amber 8%", use: "Warning alerts" },
  { name: "info", value: "#2f6690", use: "Info text, progress fill" },
  { name: "info-bg", value: "Info blue 8%", use: "Info alerts" },
  { name: "disabled-bg", value: "Deep Space Blue 6%", use: "Disabled controls" },
  { name: "disabled-fg", value: "Deep Space Blue 45%", use: "Disabled labels (exempt)" },
  { name: "focus", value: "#c1121f", use: "2 px focus ring, 2 px offset" },
  { name: "backdrop", value: "Deep Space Blue 60%", use: "Behind dialogs and sheets" },
];

export const stageColours: readonly ColourToken[] = [
  { name: "stage-bg", value: "#003049", use: "Stage background, letterbox" },
  { name: "stage-raised", value: "#1f495f", use: "Toolbars and panels" },
  { name: "stage-border", value: "#669bbc", use: "Edges of raised panels" },
  { name: "stage-text", value: "#fdf0d5", use: "Text on the stage" },
  { name: "stage-text-muted", value: "#b1b6ab", use: "Secondary text, placeholders" },
  { name: "stage-accent", value: "#669bbc", use: "Kept segments, selection" },
  { name: "stage-focus", value: "#fdf0d5", use: "2 px focus ring, 2 px offset" },
  { name: "stage-hover", value: "Cream 10%", use: "Hover on stage surfaces" },
];

const on = (fgs: readonly string[], bgs: readonly string[], kind: PairKind): ContrastPair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, kind })));

/** Every colour pair design.md relies on, by token name. */
export const lightPairs: readonly ContrastPair[] = [
  ...on(
    ["text", "text-muted", "primary", "danger", "success", "warning", "info"],
    ["bg", "surface"],
    "text",
  ),
  ...on(
    ["primary-fg"],
    ["primary", "primary-hover", "primary-active", "danger", "danger-active"],
    "text",
  ),
  ...on(["border-strong", "focus"], ["bg", "surface"], "ui"),
  ...on(["border"], ["bg", "surface"], "decorative"),
];

export const stagePairs: readonly ContrastPair[] = [
  ...on(["stage-text", "stage-text-muted"], ["stage-bg", "stage-raised"], "text"),
  ...on(["stage-bg"], ["stage-accent"], "text"),
  ...on(["stage-accent", "stage-focus"], ["stage-bg", "stage-raised"], "ui"),
  ...on(["stage-border"], ["stage-raised"], "ui"),
];

export const typeScale = [
  { name: "display", className: "text-display", size: "2.5 rem / 1.1", note: "Landing only" },
  { name: "h1", className: "text-h1", size: "2 rem / 1.2", note: "Page title" },
  { name: "h2", className: "text-h2", size: "1.5 rem / 1.25", note: "Section" },
  { name: "h3", className: "text-h3", size: "1.25 rem / 1.3", note: "Card title" },
  { name: "body", className: "text-body", size: "1 rem / 1.5", note: "Default text" },
  { name: "small", className: "text-small", size: "0.875 rem / 1.45", note: "Helper text" },
  { name: "caption", className: "text-caption", size: "0.75 rem / 1.4", note: "Smallest" },
] as const;

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
  { name: "Chips, timeline segments", className: "rounded-sm", value: "6 px" },
  { name: "Cards, buttons, inputs, dialogs", className: "rounded-md", value: "10 px" },
  { name: "Avatars, icon buttons", className: "rounded-full", value: "Full" },
] as const;

export const shadows = [
  { name: "Cards", className: "shadow-card" },
  { name: "Menus, dialogs, toasts", className: "shadow-overlay" },
] as const;

export const layers = [
  ["base", 0],
  ["sticky", 10],
  ["stage-overlay", 20],
  ["dropdown", 30],
  ["backdrop", 40],
  ["dialog", 50],
  ["toast", 60],
  ["tooltip", 70],
] as const;
