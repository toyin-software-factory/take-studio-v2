import { LIMITS, homeLimits } from "./content";
import { SectionHead } from "./head";

/** The limits: the real upload and retention numbers, from the rules (no flip motion yet). */
export function HomeLimits() {
  return (
    <section
      className="h-section h-section-flush"
      id="limits"
      aria-labelledby="limits-title"
      data-check="s6-simple-limits-free"
    >
      <div className="h-container">
        <SectionHead
          id="limits-title"
          check="s6-simple-limits-free"
          eyebrow={LIMITS.eyebrow}
          muted={LIMITS.muted}
          strong={LIMITS.strong}
        />
        <dl className="h-stats" data-enter-group data-check="s6-simple-limits-free-list">
          {homeLimits().map((s, i) => (
            <div
              key={s.unit}
              className="h-stat"
              data-enter
              data-check={i === 0 ? "s6-simple-limits-free-item" : undefined}
            >
              <dt className="h-stat-label">{s.label}</dt>
              <dd className="h-stat-num">
                <span>{s.value}</span>
                <span className="h-stat-unit">{s.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
