import { DROP_STEPS, stepLabel } from "@/lib/guest-drop";

/**
 * The three step indicator in the card head (choose, upload and email, check your email). Screen
 * readers get one line, "Step n of 3", plus the step name; the numbers and bars are decoration.
 */
export function DropSteps({ step }: { readonly step: 1 | 2 | 3 }) {
  return (
    <div className="h-drop-steps">
      <p className="h-sr-only">
        {stepLabel(step)}: {DROP_STEPS[step - 1]}
      </p>
      <ol className="h-drop-step-list" aria-hidden="true">
        {DROP_STEPS.map((name, index) => (
          <li
            key={name}
            className="h-drop-step"
            data-state={index + 1 < step ? "past" : index + 1 === step ? "now" : "next"}
          >
            <span className="h-drop-step-bar" />
            <span className="h-drop-step-name">{name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
