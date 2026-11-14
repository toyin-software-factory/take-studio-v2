import { UPLOAD_STEPS } from "@/lib/api-docs";

/** The worked example: an ordered list, each step with the command to run. */
export function UploadWalkthrough() {
  return (
    <ol className="flex flex-col gap-6">
      {UPLOAD_STEPS.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-2">
          <h3 className="text-h4">
            {index + 1}. {step.title}
          </h3>
          <p>{step.text}</p>
          <pre
            tabIndex={0}
            aria-label={`Command for step ${index + 1}`}
            className="overflow-x-auto rounded-md border border-border bg-panel p-4 font-mono text-sm outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring"
          >
            <code>{step.command}</code>
          </pre>
        </li>
      ))}
    </ol>
  );
}
