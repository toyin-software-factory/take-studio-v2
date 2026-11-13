import Link from "next/link";
import { STUDIO } from "./content";
import { SectionHead } from "./head";
import { Picture } from "./picture";

/**
 * The studio floor (spec 0010, AC-6): the dark stage with its arc on top, the particle field
 * canvas (a CSS glow until `motion/studio.ts` draws on it, or for good where the browser cannot
 * or should not), the three giant words, the glass cards and the scroll fill statement lines.
 * The canvas sits in the flow right after the heading, as in the draft, so the field opens below
 * the heading and never over it (DV0-T17).
 * Without scripts or under reduced motion the words are one plain line and the fill lines are
 * fully white; the motion adds the pinned word sequence, the field and the fill.
 */
export function HomeStudio() {
  const { trim, key, caption, agents } = STUDIO;
  return (
    <section className="h-studio" id="studio" data-theme="dark" aria-labelledby="studio-title">
      <div className="h-studio-clip">
        <div className="h-container h-studio-intro">
          <SectionHead
            id="studio-title"
            eyebrow={STUDIO.eyebrow}
            muted={STUDIO.muted}
            strong={STUDIO.strong}
          />
        </div>
        <canvas className="h-studio-field" aria-hidden="true" />
        <div className="h-studio-words">
          <div className="h-studio-word-stage" aria-hidden="true">
            {STUDIO.words.map((w) => (
              <span key={w} className="h-studio-word">
                {w}
              </span>
            ))}
          </div>
        </div>
        <p className="h-sr-only">{STUDIO.srOnly}</p>
        <div className="h-container">
          <div className="h-bento">
            <div className="h-bento-row h-bento-a" data-enter-group>
              <article className="h-glass" data-enter>
                <span className="h-chip">{trim.chip}</span>
                <h3 className="h-h4">{trim.title}</h3>
                <p>{trim.text}</p>
                <div className="h-bars" aria-hidden="true">
                  {[5, 3, 4, 2, 6, 3, 4].map((n, i) => (
                    <span key={i} style={{ flex: n }} />
                  ))}
                </div>
              </article>
              <article className="h-glass" data-enter>
                <span className="h-chip">{key.chip}</span>
                <h3 className="h-h4">{key.title}</h3>
                <p>{key.text}</p>
                <div className="h-swatches">
                  {key.swatches.map((s) => (
                    <Picture key={s.image} name={s.image} alt={s.alt} sizes="120px" />
                  ))}
                </div>
              </article>
            </div>
            <div className="h-bento-row h-bento-b" data-enter-group>
              <article className="h-glass" data-enter>
                <span className="h-chip">{caption.chip}</span>
                <h3 className="h-h4">{caption.title}</h3>
                <p>{caption.text}</p>
                <p className="h-srt" role="img" aria-label="Example SRT caption">
                  {caption.srt.map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </p>
              </article>
              <article className="h-glass" data-enter>
                <span className="h-chip h-chip-accent">{agents.chip}</span>
                <h3 className="h-h4">{agents.title}</h3>
                <p>{agents.text}</p>
              </article>
            </div>
          </div>
        </div>
        <div className="h-container h-studio-fill">
          {STUDIO.fill.map((line) => (
            // The real text is the grey layer; a white copy (aria-hidden) is revealed over it as
            // the line scrolls up, so the words are always readable at full contrast, filled or not.
            <p key={line} className="h-fill" data-fill>
              <span>{line}</span>
              <span className="h-fill-top" aria-hidden="true">
                {line}
              </span>
            </p>
          ))}
          <Link className="h-btn-split" href="/sign-in">
            <span className="h-btn-split-label">{STUDIO.cta}</span>
            <span className="h-btn-split-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" focusable="false">
                <path
                  d="M3 9h12M10 4l5 5-5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
