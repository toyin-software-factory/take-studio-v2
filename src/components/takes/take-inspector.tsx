"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TakeDetail } from "@/lib/take-api";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { PlayerBridge } from "./player-bridge";
import type { CutReview } from "./use-cut-review";
import { TakeDetails } from "./take-details";
import { TakeExport } from "./take-export";
import { TranscriptPanel } from "./transcript-panel";
import { useTranscript } from "./use-transcript";
import { useIdle } from "./use-idle";

// The Background pane is hidden until its tab is clicked, so its code loads after the first
// paint (idle, or at once when its tab is touched), and nothing moves: the pane is hidden
// either way (B2-T154).
const BackgroundChange = dynamic(
  () => import("./background-change").then((m) => m.BackgroundChange),
  { ssr: false },
);

/**
 * The inspector beside the stage (design.md §4b): pill tabs Export, Background, Transcript and
 * Details. Background and Transcript stay mounted when another tab is showing (hidden, not
 * removed), so a studio preview on the stage, the transcript's polling and the seek links keep
 * working while you look at Export. A take that is not ready yet only has Details.
 */
type InspectorProps = {
  readonly detail: TakeDetail;
  readonly bridge: PlayerBridge;
  readonly takeEmails: boolean;
  /** The email switch saved a new value: the page keeps it across the not ready to ready swap. */
  readonly onEmailsSaved: (value: boolean) => void;
  readonly review: CutReview;
  /** Opens the delete dialog (spec 0013 AC-4); `from` is the control to return focus to. */
  readonly onDelete: (from: HTMLElement | null) => void;
};

export function TakeInspector(props: InspectorProps) {
  const { take } = props.detail;
  if (take.status === "ready" || take.status === "expired") return <ReadyInspector {...props} />;
  return (
    <section aria-label="Take details" className="rounded-lg bg-card p-4 shadow-card">
      <TakeDetails
        take={take}
        takeEmails={props.takeEmails}
        onEmailsSaved={props.onEmailsSaved}
        onDelete={props.onDelete}
      />
    </section>
  );
}

/** The four tabs. Only a ready or expired take gets here, so the transcript is read once, here. */
function ReadyInspector({
  detail,
  bridge,
  takeEmails,
  onEmailsSaved,
  review,
  onDelete,
}: InspectorProps) {
  const { take } = detail;
  const transcript = useTranscript(take.id);
  const idle = useIdle();
  const [wantBackground, setWantBackground] = useState(false);
  const pane = "mt-4 outline-hidden data-[state=inactive]:hidden";
  return (
    <div className="rounded-lg bg-card p-4 shadow-card min-[1200px]:sticky min-[1200px]:top-[88px]">
      <Tabs
        defaultValue="export"
        onValueChange={(v) => v === "background" && setWantBackground(true)}
      >
        <TabsList aria-label="Take tools" className="w-full justify-start gap-1.5">
          <TabsTrigger value="export" className="px-3">
            Export
          </TabsTrigger>
          <TabsTrigger
            value="background"
            className="px-3"
            onPointerEnter={() => setWantBackground(true)}
            onFocus={() => setWantBackground(true)}
          >
            Background
          </TabsTrigger>
          <TabsTrigger value="transcript" className="px-3">
            Transcript
          </TabsTrigger>
          <TabsTrigger value="details" className="px-3">
            Details
          </TabsTrigger>
        </TabsList>
        <TabsContent value="export" className={pane}>
          <TakeExport detail={detail} transcript={transcript} />
        </TabsContent>
        <TabsContent value="background" forceMount className={pane}>
          {idle || wantBackground ? (
            <BackgroundChange detail={detail} bridge={bridge} review={review} />
          ) : null}
        </TabsContent>
        <TabsContent value="transcript" forceMount className={pane}>
          <TranscriptPanel takeId={take.id} bridge={bridge} transcript={transcript} />
        </TabsContent>
        <TabsContent value="details" className={pane}>
          <TakeDetails
            take={take}
            takeEmails={takeEmails}
            onEmailsSaved={onEmailsSaved}
            onDelete={onDelete}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
