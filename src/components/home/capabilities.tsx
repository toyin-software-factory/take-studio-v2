import { CAPABILITIES } from "./content";
import { SectionHead } from "./head";
import { TileVideo } from "./tile-video";

/** What it does: four uneven tiles, each with a caption. The fourth is text only (coming soon). */
export function HomeCapabilities() {
  return (
    <section className="h-section" id="capabilities" aria-labelledby="caps-title">
      <div className="h-container">
        <SectionHead
          id="caps-title"
          eyebrow={CAPABILITIES.eyebrow}
          muted={CAPABILITIES.muted}
          strong={CAPABILITIES.strong}
        />
        <div className="h-caps" data-enter-group>
          {CAPABILITIES.tiles.map((tile, i) => (
            <figure key={tile.key} className="h-cap" data-enter>
              <div className={`h-tile h-tile-${i + 1}`}>
                {tile.media ? (
                  <TileVideo
                    title={tile.title}
                    media={tile.media}
                    width={tile.width}
                    height={tile.height}
                  />
                ) : (
                  <p className="h-tile-soon">Coming soon</p>
                )}
              </div>
              <figcaption>
                <h3 className="h-h3">{tile.title}</h3>
                <p>{tile.text}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
