import Link from "next/link";
import { CLOSING } from "./content";

/** The closing call to action: upload the first take, or write to us. No form. */
export function HomeClosing() {
  return (
    <section
      className="h-section h-section-flush"
      id="contact"
      aria-labelledby="contact-title"
      data-check="s8-contact"
    >
      <div className="h-container h-closing">
        <div className="h-head" data-enter-group>
          <p className="h-eyebrow" data-enter data-check="s8-contact-text">
            {CLOSING.eyebrow}
          </p>
          <h2 id="contact-title" className="h-h2" data-reveal-words data-check="s8-contact-heading">
            <span className="h-muted">{CLOSING.muted}</span> {CLOSING.strong}
          </h2>
          <p className="h-lead h-closing-lead" data-enter>
            {CLOSING.lead}
          </p>
        </div>
        <div className="h-closing-actions" data-enter-group>
          <div className="h-closing-actions-inner" data-enter>
            <Link className="h-btn-split" href="/sign-in" data-check="s8-contact-cta">
              <span className="h-btn-split-label" data-check="s8-contact-cta-2">
                {CLOSING.cta}
              </span>
              <span className="h-btn-split-icon" aria-hidden="true" data-check="s8-contact-cta-3">
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
            <p className="h-closing-note">
              {CLOSING.questions}{" "}
              <a className="h-link-plain" href={`mailto:${CLOSING.email}`}>
                {CLOSING.email}
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
