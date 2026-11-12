import { Stage } from "@/components/stage";
import { ButtonDemos } from "./demo-buttons";
import { FeedbackDemos } from "./demo-feedback";
import { FormDemos } from "./demo-forms";
import { OverlayDemos } from "./demo-overlays";

/** Every base component and state, on the light shell and inside the stage (spec 0009, AC-3). */
export function ComponentsSection() {
  return (
    <>
      <section aria-labelledby="components-light" className="space-y-6">
        <h2 id="components-light" className="text-h2 font-medium">
          Components on the light shell
        </h2>
        <ButtonDemos />
        <FormDemos idPrefix="light" />
        <OverlayDemos />
        <FeedbackDemos idPrefix="light" />
      </section>
      <Stage aria-labelledby="components-stage" className="space-y-6">
        <h2 id="components-stage" className="text-h2 font-medium">
          Components on the stage
        </h2>
        <p className="text-small text-muted-foreground">
          The same components inside the stage: white pill actions, lime focus ring. Menus, dialogs
          and toasts open above the page in the light style.
        </p>
        <ButtonDemos />
        <FormDemos idPrefix="stage" />
        <OverlayDemos />
        <FeedbackDemos idPrefix="stage" />
      </Stage>
    </>
  );
}
