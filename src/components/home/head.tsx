import type { ReactNode } from "react";

/** The eyebrow and two tone heading that open a section (design.md, Typography). */
export function SectionHead({
  id,
  eyebrow,
  muted,
  strong,
  children,
  check,
}: {
  readonly id: string;
  readonly eyebrow?: string;
  readonly muted: string;
  readonly strong: string;
  readonly children?: ReactNode;
  /** Label prefix for the design check: the eyebrow is `<check>-text`, the heading `<check>-heading`. */
  readonly check?: string;
}) {
  return (
    <div className="h-head" data-enter-group>
      {eyebrow ? (
        <p className="h-eyebrow" data-enter data-check={check ? `${check}-text` : undefined}>
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        className="h-h2"
        data-reveal-words
        data-check={check ? `${check}-heading` : undefined}
      >
        <span className="h-muted">{muted}</span> {strong}
      </h2>
      {children}
    </div>
  );
}
