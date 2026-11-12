import { CAPABILITIES } from "./content";
import { SectionHead } from "./head";
import { type HomeImage, imagePath, largestWidth, videoPath } from "./media";

type Tile = (typeof CAPABILITIES.tiles)[number];

/** A tile's silent loop with its poster and the browser's controls (hover play comes later). */
function TileMedia({ tile, media }: { readonly tile: Tile; readonly media: HomeImage }) {
  return (
    <video
      controls
      muted
      loop
      playsInline
      preload="none"
      poster={imagePath(media, largestWidth(media), "jpg")}
      aria-label={`${tile.title}: short silent loop`}
      width={tile.width}
      height={tile.height}
    >
      <source src={videoPath(media as "tile-pauses", "webm")} type="video/webm" />
      <source src={videoPath(media as "tile-pauses", "mp4")} type="video/mp4" />
    </video>
  );
}

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
        <div className="h-caps">
          {CAPABILITIES.tiles.map((tile, i) => (
            <figure key={tile.key} className="h-cap">
              <div className={`h-tile h-tile-${i + 1}`}>
                {tile.media ? (
                  <TileMedia tile={tile} media={tile.media} />
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
