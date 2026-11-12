/** First focusable element on every page: jumps keyboard users past the navigation. */
export function SkipLink({ target = "content" }: { readonly target?: string }) {
  return (
    <a
      href={`#${target}`}
      className="sr-only rounded-md bg-card px-4 py-2 font-medium text-text shadow-overlay focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-(--z-tooltip) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
    >
      Skip to content
    </a>
  );
}
