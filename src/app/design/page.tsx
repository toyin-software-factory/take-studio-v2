import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ColourSection } from "./colour-section";
import { isGalleryEnabled } from "./gallery";
import { LayersSection, ShapeSection, SpacingSection, TypeSection } from "./scale-sections";
import { lightColours, lightPairs, stageColours, stagePairs } from "./tokens";

// Read the opt in variable per request, never at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design tokens · Take Studio",
  robots: { index: false, follow: false },
};

const allColours = [...lightColours, ...stageColours];

/** Token gallery (spec 0003, AC-7). Development and preview builds only; not found in production. */
export default function DesignGalleryPage() {
  if (
    !isGalleryEnabled({
      NODE_ENV: process.env.NODE_ENV,
      DESIGN_GALLERY: process.env.DESIGN_GALLERY,
    })
  ) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-content space-y-12">
      <header className="space-y-2">
        <h1 className="text-h1 font-semibold">Design tokens</h1>
        <p className="text-text-muted">
          Every token from design.md on the light app and inside the dark stage. Contrast ratios are
          computed from the token values. Base components join this page in the next milestone.
        </p>
      </header>
      <ColourSection
        id="light-colours"
        title="Light app colours"
        colours={lightColours}
        pairs={lightPairs}
        allColours={allColours}
      />
      <div className="stage space-y-6 rounded-md p-4 sm:p-6">
        <ColourSection
          id="stage-colours"
          title="Stage colours"
          colours={stageColours}
          pairs={stagePairs}
          allColours={allColours}
        />
        <p className="text-small text-text-muted">
          Inside the stage, focus rings are cream:{" "}
          <a href="#stage-colours" className="text-stage-text underline underline-offset-2">
            tab to this link
          </a>{" "}
          to see one.
        </p>
      </div>
      <TypeSection />
      <SpacingSection />
      <ShapeSection />
      <LayersSection />
    </main>
  );
}
