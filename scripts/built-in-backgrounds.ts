/**
 * The built in studio backgrounds (spec 0008): fixed IDs, names and alt text, shared by the
 * seed script and the checks. Pure data, so importing it never touches a database or R2.
 */

/** One built in studio. IDs are fixed so every environment has the same rows. */
export type BuiltInBackground = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
};

/** The built ins (the six approved studios arrive with spec 0008 build step 7). */
export const BUILT_IN_BACKGROUNDS: readonly BuiltInBackground[] = [
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000001",
    slug: "studio-placeholder",
    name: "Studio blue",
    alt: "A soft blue studio wall with a gentle diagonal light",
    width: 1920,
    height: 1080,
  },
];

export const builtInKeys = (slug: string) => ({
  imageKey: `backgrounds/builtin/${slug}.jpg`,
  thumbKey: `backgrounds/builtin/${slug}.webp`,
});
