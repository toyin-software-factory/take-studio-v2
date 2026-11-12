"use client";

import { useState, useSyncExternalStore } from "react";
import { FAQ } from "./content";
import { SectionHead } from "./head";

/**
 * Questions: a numbered accordion. Each trigger is a `<button aria-expanded>`; a closed panel is
 * `inert` once scripts run. All the answers are in the server HTML and not inert there; the
 * `noscript` style in the page shows them for a visitor without scripts.
 */
export function HomeFaq() {
  const [open, setOpen] = useState<number | null>(null);
  // False in the server HTML, true once the page has hydrated: closed panels are `inert` only
  // when scripts run, so without scripts every answer stays readable (also to screen readers).
  const interactive = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  return (
    <section className="h-section h-section-flush" id="faq" aria-labelledby="faq-title">
      <div className="h-container h-faq">
        <SectionHead id="faq-title" eyebrow={FAQ.eyebrow} muted={FAQ.muted} strong={FAQ.strong} />
        <div className="h-acc">
          {FAQ.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="h-acc-item" data-open={isOpen}>
                <h3>
                  <button
                    type="button"
                    className="h-acc-trigger"
                    aria-expanded={isOpen}
                    aria-controls={`faq-${i + 1}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    <span className="h-acc-num">{String(i + 1).padStart(2, "0")}.</span>
                    <span className="h-h4">{item.q}</span>
                    <span className="h-acc-icon" aria-hidden="true" />
                  </button>
                </h3>
                <div
                  className="h-acc-panel"
                  id={`faq-${i + 1}`}
                  role="region"
                  inert={interactive && !isOpen}
                >
                  <div className="h-acc-inner">
                    <p>{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
