import type { PairKind } from "./contrast";

/**
 * B2-T139: every text or icon token that may sit on a surface, with the reason. A new token or a
 * new pairing has to be added here on purpose (`contrast-pairs.test.ts` fails on a colour token
 * that is neither used nor exempt). Names are CSS tokens without the leading `--`.
 */
export type Layer = {
  readonly token: string;
  readonly alpha?: number | { readonly fromSource: readonly [string, RegExp] };
};
export type Surface = {
  /** Layers from the bottom up; a translucent one is blended over what is under it. */
  readonly stack: readonly Layer[];
  /** What can show through the stack: the darkest and lightest thing that can scroll under it. */
  readonly under: readonly string[];
};

const WHITE = "color-bg";
const BLACK = "color-dark";
const bar = (file: string, re: RegExp): Layer => ({
  token: "color-bg",
  alpha: { fromSource: [file, re] },
});

export const surfaces: Readonly<Record<string, Surface>> = {
  page: { stack: [{ token: "color-bg" }], under: [WHITE] },
  panel: { stack: [{ token: "color-surface" }], under: [WHITE] },
  primary: { stack: [{ token: "color-ink" }], under: [WHITE] },
  "primary-hover": { stack: [{ token: "color-ink-soft" }], under: [WHITE] },
  lime: { stack: [{ token: "color-accent" }], under: [WHITE] },
  "white-fill": { stack: [{ token: "color-on-dark" }], under: [WHITE] },
  stage: { stack: [{ token: "color-dark" }], under: [BLACK] },
  "stage-raised": { stack: [{ token: "color-dark-2" }], under: [BLACK] },
  // The sticky app top bar: glass over whatever scrolls under it, the dark stage included (B2-T136).
  "top-bar": {
    stack: [bar("src/components/shell/top-bar.tsx", /\bbg-background\/(\d+)\b/)],
    under: [BLACK, WHITE],
  },
  "top-bar-success-chip": {
    stack: [
      bar("src/components/shell/top-bar.tsx", /\bbg-background\/(\d+)\b/),
      {
        token: "color-success",
        alpha: { fromSource: ["src/app/styles/root.css", /--success-bg:[^;]*?(\d+)%/] },
      },
    ],
    under: [BLACK, WHITE],
  },
  // The homepage nav: a light glass bar over the dark studio section, a dark glass pill over dark sections.
  "home-nav-light": { stack: [{ token: "color-nav-glass-light" }], under: [BLACK, WHITE] },
  "home-nav-dark": { stack: [{ token: "color-nav-glass-dark" }], under: [BLACK] },
  // Glass cards and the srt line sit on the dark studio section and the phone reel.
  "stage-glass": { stack: [{ token: "color-glass" }], under: [BLACK] },
  // The play and pause toggle floats over video frames, which can be white.
  "media-glass": { stack: [{ token: "color-media-glass" }], under: [BLACK, WHITE] },
};

export type Pair = {
  readonly fg: string;
  readonly on: keyof typeof surfaces;
  readonly kind: PairKind;
  readonly reason: string;
};

export const pairs: readonly Pair[] = [
  {
    fg: "color-ink",
    on: "page",
    kind: "text",
    reason: "body text on the white shell, cards and dialogs",
  },
  { fg: "color-ink", on: "panel", kind: "text", reason: "text on panels and tiles" },
  { fg: "color-text-muted", on: "page", kind: "text", reason: "helper and meta text" },
  { fg: "color-text-muted", on: "panel", kind: "text", reason: "helper text on panels" },
  { fg: "color-success", on: "page", kind: "text", reason: "success label and icon" },
  { fg: "color-success", on: "panel", kind: "text", reason: "success label on a panel" },
  { fg: "color-warning", on: "page", kind: "text", reason: "warning label and icon" },
  { fg: "color-warning", on: "panel", kind: "text", reason: "warning label on a panel" },
  { fg: "color-error", on: "page", kind: "text", reason: "error label and icon" },
  { fg: "color-error", on: "panel", kind: "text", reason: "error label on a panel" },
  { fg: "color-line-strong", on: "page", kind: "ui", reason: "form borders (1.4.11)" },
  { fg: "color-line-strong", on: "panel", kind: "ui", reason: "form borders on a panel" },
  { fg: "color-on-dark", on: "primary", kind: "text", reason: "primary button label" },
  {
    fg: "color-on-dark",
    on: "primary-hover",
    kind: "text",
    reason: "primary button label on hover",
  },
  { fg: "color-ink", on: "lime", kind: "text", reason: "text on the lime accent fill" },
  {
    fg: "color-ink",
    on: "white-fill",
    kind: "text",
    reason: "Use this take label on the Review step, white fill over the dark stage",
  },
  { fg: "color-on-dark", on: "stage", kind: "text", reason: "text on the stage" },
  { fg: "color-on-dark-75", on: "stage", kind: "text", reason: "body text on the stage" },
  { fg: "color-on-dark-60", on: "stage", kind: "text", reason: "meta text on the stage" },
  { fg: "color-on-dark", on: "stage-raised", kind: "text", reason: "text on raised stage panels" },
  {
    fg: "color-on-dark-75",
    on: "stage-raised",
    kind: "text",
    reason: "body text on raised stage panels",
  },
  {
    fg: "color-on-dark-60",
    on: "stage-raised",
    kind: "text",
    reason: "meta text on raised stage panels",
  },
  {
    fg: "color-accent",
    on: "stage",
    kind: "ui",
    reason: "focus ring and accent icons on the stage",
  },
  {
    fg: "color-accent",
    on: "stage-raised",
    kind: "ui",
    reason: "focus ring on raised stage panels",
  },
  { fg: "color-on-dark-60", on: "stage", kind: "ui", reason: "strong borders on the stage" },
  { fg: "color-ink", on: "top-bar", kind: "text", reason: "top bar title and menu button" },
  {
    fg: "color-text-muted",
    on: "top-bar",
    kind: "text",
    reason: "top bar usage and secondary text",
  },
  {
    fg: "color-success",
    on: "top-bar-success-chip",
    kind: "text",
    reason: "status chip on the top bar (B2-T136)",
  },
  {
    fg: "color-ink",
    on: "home-nav-light",
    kind: "text",
    reason: "homepage nav links over the dark studio section",
  },
  {
    fg: "color-on-dark",
    on: "home-nav-dark",
    kind: "text",
    reason: "homepage nav links in the dark pill",
  },
  {
    fg: "color-on-dark",
    on: "stage-glass",
    kind: "ui",
    reason: "player control icons on glass",
  },
  {
    fg: "color-on-dark",
    on: "media-glass",
    kind: "ui",
    reason: "play and pause toggle over a video frame, even a white one",
  },
  {
    fg: "color-on-dark-75",
    on: "stage-glass",
    kind: "text",
    reason: "glass card and srt line text",
  },
  { fg: "color-accent", on: "stage-glass", kind: "text", reason: "srt highlighted word" },
];

/** Colour tokens with no text or icon on them: borders, rings, fills and layers that only tint. */
export const exempt: Readonly<Record<string, string>> = {
  "color-transparent": "keyword, not a colour",
  "color-current": "keyword, not a colour",
  "color-line": "hairline, decorative",
  "color-hairline": "ring, decorative",
  "color-on-dark-20": "borders on dark, decorative",
  "color-line-dark": "hairlines on dark, decorative",
  "color-ring-dark": "ring on dark, decorative",
  "color-field-1": "gradient stop of the hero field, no text of its own",
  "color-field-2": "gradient stop of the hero field, no text of its own",
  "color-field-3": "gradient stop of the hero field, no text of its own",
  "color-dark-2": "used as the stage-raised surface",
};
