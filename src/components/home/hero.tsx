import { FAN_CARDS, HERO } from "./content";
import { Picture } from "./picture";

/** Hero: the two tone headline, the lead and the fan of product cards (no motion yet). */
export function HomeHero() {
  return (
    <section className="h-hero" id="top" aria-labelledby="hero-title">
      <div className="h-container">
        <h1 className="h-h1" id="hero-title">
          <span className="h-muted">{HERO.muted}</span> <br />
          {HERO.strong}
        </h1>
        <p className="h-lead h-hero-lead">{HERO.lead}</p>
        <div className="h-fan" role="group" aria-label="What Take Studio does">
          <ul className="h-fan-list">
            {FAN_CARDS.map((card, i) => (
              <li key={card.image} style={{ "--n": i } as React.CSSProperties}>
                <a className="h-fan-card" href={card.href} aria-label={card.label}>
                  <Picture
                    name={card.image}
                    alt=""
                    sizes="(min-width: 1200px) 250px, 17vw"
                    priority={i < 3}
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
