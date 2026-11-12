import { layers, radii, shadows, spacingScale, typeScale } from "./tokens";

/** Heading plus body for one gallery section. */
function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-h2 font-medium">
        {title}
      </h2>
      <div className="rounded-md bg-card p-6 shadow-card">{children}</div>
    </section>
  );
}

/** Inter Tight scale from display to caption, plus the tabular mono sample. */
export function TypeSection() {
  return (
    <Section id="type" title="Type">
      <ul className="space-y-4">
        {typeScale.map((step) => (
          <li key={step.name} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <span className="mono text-caption text-muted-foreground">
              {step.name} · {step.size}
            </span>
            <span className={`${step.className} min-w-0 overflow-hidden`}>
              {"sample" in step ? step.sample : `Your take, trimmed and ready (${step.note})`}
            </span>
          </li>
        ))}
        <li className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <span className="mono text-caption text-muted-foreground">.mono · tabular</span>
          <span className="mono">01:23 · 12:05 · 1:02:41 · 1.2 GB · 980 MB</span>
        </li>
      </ul>
    </Section>
  );
}

/** The 4 px spacing scale as bars. */
export function SpacingSection() {
  return (
    <Section id="spacing" title="Spacing">
      <ul className="space-y-2">
        {spacingScale.map((step) => (
          <li key={step.px} className="flex items-center gap-4">
            <span className="mono w-12 text-small text-muted-foreground">{step.px} px</span>
            <span className={`${step.className} h-4 rounded-sm bg-text`} aria-hidden="true" />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Corner radii and the two shadows. */
export function ShapeSection() {
  return (
    <Section id="shape" title="Radius and elevation">
      <ul className="flex flex-wrap gap-6">
        {radii.map((radius) => (
          <li key={radius.className} className="w-40 space-y-2">
            <div
              className={`${radius.className} h-16 w-16 border-2 border-border-strong bg-background`}
            />
            <p className="text-small font-medium">{radius.value}</p>
            <p className="text-caption text-muted-foreground">{radius.name}</p>
          </li>
        ))}
        {shadows.map((shadow) => (
          <li key={shadow.className} className="w-40 space-y-2">
            <div className={`${shadow.className} h-16 w-16 rounded-md bg-card`} />
            <p className="text-small font-medium">{shadow.className}</p>
            <p className="text-caption text-muted-foreground">{shadow.name}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** z-index layers and motion timing. */
export function LayersSection() {
  return (
    <Section id="layers" title="Layers and motion">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {layers.map(([name, value]) => (
          <div key={name}>
            <dt className="text-small text-muted-foreground">--z-{name}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-small">
        Motion is 150 to 200 ms ease out. With reduced motion turned on, animations and transitions
        stop, so skeletons are static and nothing slides in.
      </p>
      <div
        className="mt-4 h-2 w-24 animate-pulse rounded-sm bg-disabled-bg"
        aria-hidden="true"
        data-testid="motion-sample"
      />
    </Section>
  );
}
