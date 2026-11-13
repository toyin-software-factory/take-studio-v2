import { REEL } from "./content";
import { ReelVideo } from "./reel-video";

/**
 * The reel: a 16:9 video of a take being trimmed, keyed and captioned (spec 0010, AC-5). At 810
 * px and up, with motion allowed, `motion/reel.ts` pins the section and opens the video from the
 * corner slot to full bleed while scrolling; everywhere else it is this inline 16:9 video that
 * plays when the visitor presses play.
 */
export function HomeReel() {
  return (
    <section className="h-reel" id="reel" aria-labelledby="reel-title" data-check="s2-reel">
      <div className="h-reel-sticky">
        <div className="h-container h-reel-head">
          <h2
            className="h-h2 h-reel-title"
            id="reel-title"
            data-reveal-words
            data-check="s2-reel-heading"
          >
            <span className="h-muted">{REEL.muted}</span> {REEL.strong}
          </h2>
          <div className="h-reel-slot" aria-hidden="true" />
        </div>
        <div className="h-reel-media">
          <ReelVideo />
        </div>
      </div>
    </section>
  );
}
