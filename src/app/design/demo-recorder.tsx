"use client";

import { Circle, Square } from "lucide-react";
import "@/components/record/stage.css";
import "@/components/record/stage-panel.css";
import { PauseButton, PrompterControls } from "@/components/record/prompter-controls";
import { PrompterText } from "@/components/record/prompter-text";
import { usePrompter } from "@/components/record/use-prompter";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const SAMPLE_SCRIPT = [
  "Hi, I'm Ada, and this is the teleprompter.",
  "It scrolls at the speed you choose.",
  "Pause it any time with the P key.",
  "Your recording keeps going while the script waits.",
].join("\n");

/**
 * The recorder as it looks on /record (spec 0021 task 5): the script over a preview frame, the
 * prompter controls and the Record and Stop buttons. A plain dark box stands in for the camera.
 * The gallery's prompter keeps its settings under its own key, never a creator's.
 */
export function RecorderDemo() {
  const prompter = usePrompter(SAMPLE_SCRIPT, "design-gallery", false, true);
  return (
    <section aria-labelledby="recorder-controls" className="space-y-4">
      <h2 id="recorder-controls" className="text-h2 font-medium">
        Prompter and recorder controls
      </h2>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-dark">
        <div className="pointer-events-none absolute inset-x-3 top-3 bottom-12 flex flex-col gap-2">
          <PrompterText prompter={prompter} />
        </div>
        <div className="absolute right-3 bottom-3">
          <PauseButton prompter={prompter} />
        </div>
        <span className="mono absolute bottom-3 left-3 rounded-md bg-nav-glass-dark px-2 py-1 text-small text-on-dark">
          Up to 60:00
        </span>
      </div>
      <div className="rounded-lg bg-dark p-3">
        <div className="rst-panel">
          <PrompterControls prompter={prompter} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button size="lg">
          <Icon icon={Circle} /> Record
        </Button>
        <Button size="lg" variant="destructive">
          <Icon icon={Square} /> Stop
        </Button>
        <Button size="lg" disabled>
          <Icon icon={Circle} /> Starting…
        </Button>
      </div>
      <p className="text-small text-muted-foreground">
        The script sits at the top of the preview, near the lens on a laptop and across the top of a
        phone screen. Buttons are 44 px tall on touch screens, and the keys P, Up, Down, + and −
        work anywhere except a text field.
      </p>
    </section>
  );
}
