import { ButtonDemos } from "./demo-buttons";
import { FeedbackDemos } from "./demo-feedback";
import { FormDemos } from "./demo-forms";
import { OverlayDemos } from "./demo-overlays";

/** Every base component and state, on the light app and inside the stage (spec 0003, AC-3). */
export function ComponentsSection() {
  return (
    <>
      <section aria-labelledby="components-light" className="space-y-6">
        <h2 id="components-light" className="text-h2 font-semibold">
          Components on the light app
        </h2>
        <ButtonDemos />
        <FormDemos idPrefix="light" />
        <OverlayDemos />
        <FeedbackDemos idPrefix="light" />
      </section>
      <section aria-labelledby="components-stage" className="stage space-y-6 rounded-md p-4 sm:p-6">
        <h2 id="components-stage" className="text-h2 font-semibold">
          Components on the stage
        </h2>
        <p className="text-small text-text-muted">
          The same components inside the stage: Steel Blue actions, cream focus ring. Menus, dialogs
          and toasts open above the page in the light style.
        </p>
        <ButtonDemos />
        <FormDemos idPrefix="stage" />
        <OverlayDemos />
        <FeedbackDemos idPrefix="stage" />
      </section>
    </>
  );
}
