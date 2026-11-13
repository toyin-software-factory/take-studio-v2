import { FAN_CARDS, HERO } from "./content";
import { FanToggle } from "./fan-toggle";
import { Picture } from "./picture";

/** The draft labels the four fan images `s1-top-media`, `-2`, `-3` and `-4` (design check). */
const fanCheck = (i: number) =>
  i < 4 ? (i === 0 ? "s1-top-media" : `s1-top-media-${i + 1}`) : undefined;

/** Hero: the two tone headline, the lead and the fan of product cards (no motion yet). */
export function HomeHero() {
  return (
    <section className="h-hero" id="top" aria-labelledby="hero-title" data-check="s1-top">
      <div className="h-container">
        <h1 className="h-h1" id="hero-title" data-check="s1-top-heading">
          <span data-line className="h-muted">
            {HERO.muted}
          </span>{" "}
          <br />
          <span data-line>{HERO.strong}</span>
        </h1>
        <p className="h-lead h-hero-lead" data-check="s1-top-text">
          {HERO.lead}
        </p>
        <div className="h-fan" role="group" aria-label="What Take Studio does">
          <ul className="h-fan-list" data-check="s1-top-list">
            {FAN_CARDS.map((card, i) => (
              <li
                key={card.image}
                style={{ "--n": i } as React.CSSProperties}
                data-check={i === 0 ? "s1-top-item" : undefined}
              >
                <a className="h-fan-card" href={card.href} aria-label={card.label}>
                  <Picture
                    name={card.image}
                    alt=""
                    sizes="(min-width: 1200px) 250px, 17vw"
                    priority={i < 3}
                    check={fanCheck(i)}
                  />
                </a>
              </li>
            ))}
          </ul>
          <FanToggle />
        </div>
      </div>
    </section>
  );
}
