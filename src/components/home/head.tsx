import type { ReactNode } from "react";

/** The eyebrow and two tone heading that open a section (design.md, Typography). */
export function SectionHead({
  id,
  eyebrow,
  muted,
  strong,
  children,
}: {
  readonly id: string;
  readonly eyebrow?: string;
  readonly muted: string;
  readonly strong: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="h-head" data-enter-group>
      {eyebrow ? (
        <p className="h-eyebrow" data-enter>
          {eyebrow}
        </p>
      ) : null}
      <h2 id={id} className="h-h2" data-reveal-words>
        <span className="h-muted">{muted}</span> {strong}
      </h2>
      {children}
    </div>
  );
}
