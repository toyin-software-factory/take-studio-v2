import { REEL } from "./content";
import { imagePath, largestWidth, videoPath } from "./media";

/**
 * The reel: a 16:9 video of a take being trimmed, keyed and captioned, with its poster and the
 * browser's own controls. The corner thumbnail that expands on scroll comes with the motion work.
 */
export function HomeReel() {
  return (
    <section className="h-reel" id="reel" aria-labelledby="reel-title">
      <div className="h-container">
        <h2 className="h-h2 h-reel-title" id="reel-title">
          <span className="h-muted">{REEL.muted}</span> {REEL.strong}
        </h2>
      </div>
      <div className="h-reel-media">
        <video
          controls
          muted
          loop
          playsInline
          preload="none"
          poster={imagePath("reel-poster", largestWidth("reel-poster"), "jpg")}
          aria-label={REEL.label}
          width={1280}
          height={720}
        >
          <source src={videoPath("reel", "webm")} type="video/webm" />
          <source src={videoPath("reel", "mp4")} type="video/mp4" />
        </video>
      </div>
    </section>
  );
}
