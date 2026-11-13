import { ClosingForm } from "./closing-form";
import { CLOSING } from "./content";

/** The closing call to action: upload the first take, by email link, the same sign in as /sign-in, or write to us. */
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
        <ClosingForm />
      </div>
    </section>
  );
}
