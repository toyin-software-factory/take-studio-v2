import { Pause, Play, RotateCcw, Scissors } from "lucide-react";
import { Stage, StageLetterbox, StagePanel } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** The Stage container: raised toolbar with a border, stage controls, letterbox colour. */
export function StageDemo() {
  return (
    <section aria-labelledby="stage-container" className="space-y-4">
      <h2 id="stage-container" className="text-h2 font-medium">
        Stage container
      </h2>
      <Stage label="Stage example" className="space-y-4">
        <StageLetterbox>
          {/* A 4:3 frame inside the 16:9 box: the bars either side are the stage colour. */}
          <div className="flex aspect-[4/3] h-full items-center justify-center bg-stage-raised text-small text-stage-text-muted">
            4:3 video, letterboxed
          </div>
        </StageLetterbox>
        <StagePanel className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Play">
            <Icon icon={Play} size="stage" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Pause" className="bg-hover-surface">
            <Icon icon={Pause} size="stage" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Undo">
            <Icon icon={RotateCcw} size="stage" />
          </Button>
          <span className="mono ml-auto text-small">01:23 / 04:12</span>
          <Button size="sm">
            <Icon icon={Scissors} size="badge" />
            Render
          </Button>
        </StagePanel>
        <p className="text-small text-muted-foreground">
          The toolbar is a raised panel with a hairline edge. The second button shows the stage
          hover; tab through to see the lime focus ring.
        </p>
      </Stage>
    </section>
  );
}
