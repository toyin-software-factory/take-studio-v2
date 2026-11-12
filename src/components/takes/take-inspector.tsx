"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TakeDetail } from "@/lib/take-api";
import { BackgroundChange } from "./background-change";
import type { PlayerBridge } from "./player-bridge";
import type { PollResult } from "./use-poll";
import { TakeDetails } from "./take-details";
import { TakeExport } from "./take-export";
import { TranscriptPanel } from "./transcript-panel";
import { useTranscript } from "./use-transcript";

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
  readonly onStarted: (target: string | null) => void;
  readonly onUncertain: () => Promise<PollResult>;
  readonly onStale: () => void;
};

export function TakeInspector(props: InspectorProps) {
  const { take } = props.detail;
  if (take.status === "ready" || take.status === "expired") return <ReadyInspector {...props} />;
  return (
    <section aria-label="Take details" className="rounded-lg bg-card p-4 shadow-card">
      <TakeDetails take={take} takeEmails={props.takeEmails} />
    </section>
  );
}

/** The four tabs. Only a ready or expired take gets here, so the transcript is read once, here. */
function ReadyInspector({
  detail,
  bridge,
  takeEmails,
  onStarted,
  onUncertain,
  onStale,
}: InspectorProps) {
  const { take } = detail;
  const transcript = useTranscript(take.id);
  const pane = "mt-4 outline-hidden data-[state=inactive]:hidden";
  return (
    <div className="rounded-lg bg-card p-4 shadow-card min-[1200px]:sticky min-[1200px]:top-[88px]">
      <Tabs defaultValue="export">
        <TabsList aria-label="Take tools" className="w-full justify-start gap-1.5">
          <TabsTrigger value="export" className="px-3">
            Export
          </TabsTrigger>
          <TabsTrigger value="background" className="px-3">
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
          <BackgroundChange
            detail={detail}
            bridge={bridge}
            onStarted={onStarted}
            onUncertain={onUncertain}
            onStale={onStale}
          />
        </TabsContent>
        <TabsContent value="transcript" forceMount className={pane}>
          <TranscriptPanel takeId={take.id} bridge={bridge} transcript={transcript} />
        </TabsContent>
        <TabsContent value="details" className={pane}>
          <TakeDetails take={take} takeEmails={takeEmails} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
