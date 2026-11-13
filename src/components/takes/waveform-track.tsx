/**
 * The loudness bars behind the cut blocks (spec 0011, AC-1, AC-10): a decorative picture, hidden
 * from assistive technology. No values means a plain track.
 */
export function WaveformTrack({ values }: { readonly values: readonly number[] | null }) {
  if (!values || values.length === 0) {
    return <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-stage-border" />;
  }
  const bar = (v: number, i: number) => {
    const h = Math.max(2, Math.min(100, v));
    return `M${i} ${50 - h / 2}h0.7v${h}h-0.7z`;
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${values.length} 100`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full text-stage-text-muted opacity-60"
    >
      <path fill="currentColor" d={values.map(bar).join("")} />
    </svg>
  );
}
