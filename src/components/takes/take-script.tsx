import { useId } from "react";

/**
 * The creator's own script for this take (spec 0021 AC-8), read only on the Details tab. Long
 * text wraps and scrolls inside a box of fixed height, so the tab never jumps. Takes made
 * without a script say so. The text is personal data: it is shown here and nowhere else.
 */
export function TakeScript({ script }: { readonly script: string | null }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 id={id} className="text-small font-medium">
        Script
      </h3>
      {script ? (
        <p
          tabIndex={0}
          data-testid="take-script"
          className="max-h-48 overflow-y-auto rounded-md bg-muted px-3 py-2 text-small break-words whitespace-pre-wrap"
        >
          {script}
        </p>
      ) : (
        <p className="text-small text-muted-foreground">No script for this take.</p>
      )}
    </section>
  );
}
