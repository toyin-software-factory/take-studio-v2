import { CAPABILITIES } from "./content";
import { SectionHead } from "./head";
import { TileVideo } from "./tile-video";

/** The draft tags the poster and video of the first two tiles, and all four tile headings. */
const tileChecks = (i: number) =>
  i === 0
    ? { image: "s5-capabilities-media", video: "s5-capabilities-media-2" }
    : i === 1
      ? { image: "s5-capabilities-media-3", video: "s5-capabilities-media-4" }
      : undefined;
const headingCheck = (i: number) => `s5-capabilities-heading-${i + 2}`;

/** What it does: four uneven tiles, each with a caption. The fourth is text only (coming soon). */
export function HomeCapabilities() {
  return (
    <section
      className="h-section"
      id="capabilities"
      aria-labelledby="caps-title"
      data-check="s5-capabilities"
    >
      <div className="h-container">
        <SectionHead
          id="caps-title"
          check="s5-capabilities"
          eyebrow={CAPABILITIES.eyebrow}
          muted={CAPABILITIES.muted}
          strong={CAPABILITIES.strong}
        />
        <div className="h-caps" data-enter-group data-check="s5-capabilities-list">
          {CAPABILITIES.tiles.map((tile, i) => (
            <figure
              key={tile.key}
              className="h-cap"
              data-enter
              data-check={i === 0 ? "s5-capabilities-item" : undefined}
            >
              <div className={`h-tile h-tile-${i + 1}`}>
                {tile.media ? (
                  <TileVideo
                    title={tile.title}
                    media={tile.media}
                    width={tile.width}
                    height={tile.height}
                    checks={tileChecks(i)}
                  />
                ) : (
                  <p className="h-tile-soon">Coming soon</p>
                )}
              </div>
              <figcaption>
                <h3 className="h-h3" data-check={headingCheck(i)}>
                  {tile.title}
                </h3>
                <p>{tile.text}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
