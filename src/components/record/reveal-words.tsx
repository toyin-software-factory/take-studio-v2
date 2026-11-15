export type HeadingLine = { readonly text: string; readonly muted?: boolean };

/**
 * A heading whose words rise inside masks when the page loads (design.md recipe 7.1, the
 * homepage's look). CSS only, and only under `prefers-reduced-motion: no-preference`, so there is
 * no library to load and reduced motion shows the plain heading. The heading keeps its text as an
 * `aria-label` and the word spans are `aria-hidden`, so a screen reader reads it once, whole.
 */
export function RevealWords({
  id,
  lines,
  ...rest
}: {
  readonly id: string;
  readonly lines: readonly HeadingLine[];
} & Record<`data-${string}`, string>) {
  let index = 0;
  return (
    <h2 id={id} className="rec-h1" aria-label={lines.map((line) => line.text).join(" ")} {...rest}>
      {lines.map((line) => (
        <span key={line.text} className={line.muted ? "rec-muted" : undefined}>
          {line.text.split(" ").map((word) => (
            <span key={`${index}-${word}`} className="rec-w" aria-hidden="true">
              <span style={{ ["--i" as string]: index++ }}>{word}</span>{" "}
            </span>
          ))}
        </span>
      ))}
    </h2>
  );
}
