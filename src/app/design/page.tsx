import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SkipLink } from "@/components/shell/skip-link";
import { Stage } from "@/components/stage";
import { Toaster } from "@/components/ui/sonner";
import { ColourSection } from "./colour-section";
import { ComponentsSection } from "./components-section";
import { StageDemo } from "./demo-stage";
import { isGalleryEnabled } from "./gallery";
import { LayersSection, ShapeSection, SpacingSection, TypeSection } from "./scale-sections";
import { lightColours, lightPairs, stageColours, stagePairs } from "./tokens";

// Read the opt in variable per request, never at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design system · Take Studio",
  robots: { index: false, follow: false },
};

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
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto max-w-content space-y-12 px-4 py-8 outline-hidden md:px-6"
      >
        <header className="space-y-2">
          <h1 className="text-h1">Design system</h1>
          <p className="text-muted-foreground">
            Every token and base component from design.md, on the light shell and inside the dark
            stage. Contrast ratios are computed from the token values.
          </p>
        </header>
        <ColourSection
          id="light-colours"
          title="Light shell colours"
          colours={lightColours}
          pairs={lightPairs}
        />
        <Stage className="space-y-6">
          <ColourSection
            id="stage-colours"
            title="Dark stage colours"
            colours={stageColours}
            pairs={stagePairs}
          />
          <p className="text-small text-muted-foreground">
            Inside the stage, focus rings are lime:{" "}
            <a href="#stage-colours" className="text-stage-text underline underline-offset-2">
              tab to this link
            </a>{" "}
            to see one.
          </p>
        </Stage>
        <TypeSection />
        <SpacingSection />
        <ShapeSection />
        <LayersSection />
        <StageDemo />
        <ComponentsSection />
        <Toaster />
      </main>
    </>
  );
}
