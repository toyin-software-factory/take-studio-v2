const STEPS = ["01. Script", "02. Record", "03. Review"] as const;

/** The three steps. The current one is `aria-current="step"`, finished ones keep a dark line. */
export function RecordSteps({ current }: { readonly current: 1 | 2 | 3 }) {
  return (
    <ol className="rec-steps" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i + 1 === current ? "step" : undefined}
          data-done={i + 1 < current ? "" : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}
