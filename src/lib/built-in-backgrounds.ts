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
  /**
   * A studio that only exists for local runs and tests. It is never installed into a database
   * that is not on this machine, so live creators can never see a test background.
   */
  readonly testOnly?: boolean;
};

/**
 * The built ins: Toyin's six approved studios (spec 0008, AC-7, all 1672 by 941 JPEGs with a
 * 480 by 270 WebP thumbnail in `assets/backgrounds/`, made with the same rules as the ingest:
 * fitted inside 3840 by 2160, never enlarged), and the placeholder, which is for local runs and
 * tests only. The podcast studio keeps its lit ON AIR sign (Toyin's choice). The order is the
 * order the picker shows them in. IDs are fixed and never reused; the source PNGs are kept in
 * `assets/backgrounds/source/`.
 */
export const BUILT_IN_BACKGROUNDS: readonly BuiltInBackground[] = [
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000002",
    slug: "warm-podcast",
    name: "Warm podcast studio",
    alt: "A warm podcast studio with wood panelling and red sound panels, two microphones on arms, a round table with coffee cups and a plant, a lit ON AIR sign and two cream armchairs.",
    width: 1672,
    height: 941,
  },
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000003",
    slug: "bright-minimal",
    name: "Bright minimal studio",
    alt: "A bright cream room with a window on the left, two microphones on arms, a round light wood table with a plant and two mugs, and a plant on a navy shelf behind.",
    width: 1672,
    height: 941,
  },
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000004",
    slug: "bookshelf-office",
    name: "Bookshelf office",
    alt: "A sunlit office with a tall wooden bookshelf of red and blue books, a trailing plant, a globe and a brass lamp, and a wooden desk with a laptop, a mug and a notebook.",
    width: 1672,
    height: 941,
  },
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000005",
    slug: "palette-gradient",
    name: "Soft blue gradient",
    alt: "A smooth blue studio backdrop that is lighter in the middle and darker at the edges, with a soft glow along the floor.",
    width: 1672,
    height: 941,
  },
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000006",
    slug: "dark-stage",
    name: "Dark stage",
    alt: "A dark blue stage with two soft spotlights in the top corners, light haze and a glowing horizon line above a reflective floor.",
    width: 1672,
    height: 941,
  },
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000007",
    slug: "plant-corner",
    name: "Plant corner",
    alt: "A sunlit cream corner with a large leafy plant in a woven basket beside a window with a sheer curtain, leaf shadows on the wall and a small side table with a plant and a lamp.",
    width: 1672,
    height: 941,
  },
  {
    id: "0b9d5e0a-7c1f-4a54-9d3e-5a1c00000001",
    slug: "studio-placeholder",
    name: "Studio blue",
    alt: "A soft blue studio wall with a gentle diagonal light",
    width: 1920,
    height: 1080,
    testOnly: true,
  },
];

/** The studios to install: all of them locally, only the real ones (not `testOnly`) elsewhere. */
export function studiosToInstall(local: boolean): readonly BuiltInBackground[] {
  return BUILT_IN_BACKGROUNDS.filter((b) => local || b.testOnly !== true);
}

export const builtInKeys = (slug: string) => ({
  imageKey: `backgrounds/builtin/${slug}.jpg`,
  thumbKey: `backgrounds/builtin/${slug}.webp`,
});
