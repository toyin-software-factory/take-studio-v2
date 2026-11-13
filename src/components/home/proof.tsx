import { PROOF } from "./content";
import { SectionHead } from "./head";

/** Made for solo creators: where people post, and the files Take Studio works with. */
export function HomeProof() {
  return (
    <section className="h-section" aria-labelledby="proof-title" data-check="s3-you-film-alone">
      <div className="h-container">
        <SectionHead
          id="proof-title"
          check="s3-you-film-alone"
          eyebrow={PROOF.eyebrow}
          muted={PROOF.muted}
          strong={PROOF.strong}
        />
      </div>
      <div
        className="h-rows"
        role="group"
        aria-label="Where creators post, and the files Take Studio works with"
      >
        <ul className="h-drift" data-check="s3-you-film-alone-list">
          {PROOF.platforms.map((p, i) => (
            <li key={p} data-check={i === 0 ? "s3-you-film-alone-item" : undefined}>
              {p}
            </li>
          ))}
        </ul>
        <ul className="h-drift h-drift-formats">
          {PROOF.formats.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
