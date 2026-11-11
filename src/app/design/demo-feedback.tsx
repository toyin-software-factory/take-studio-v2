import { CircleAlert, CircleCheck, Clock, Info, LoaderCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DemoBlock, DemoGroup } from "./demo-block";

/** Alerts, badges, progress, skeletons, card, tabs and avatar. */
export function FeedbackDemos({ idPrefix }: { readonly idPrefix: string }) {
  return (
    <DemoGroup title="Status, progress and layout">
      <div className="grid gap-3 md:grid-cols-2">
        <Alert variant="info" title="Transcripts arrive in slice 2">
          Nothing to do yet.
        </Alert>
        <Alert variant="success" title="Take rendered">
          Your video is ready to download.
        </Alert>
        <Alert variant="warning" title="Video expires in 2 days">
          Download it to keep a copy.
        </Alert>
        <Alert variant="danger" title="Upload rejected">
          This video is 14 minutes long. The limit is 10 minutes.
        </Alert>
      </div>
      <DemoBlock title="Badges (icon plus label)">
        <Badge icon={Clock}>Queued</Badge>
        <Badge variant="info" icon={LoaderCircle}>
          Processing
        </Badge>
        <Badge variant="success" icon={CircleCheck}>
          Ready
        </Badge>
        <Badge variant="warning" icon={Info}>
          Expires soon
        </Badge>
        <Badge variant="danger" icon={CircleAlert}>
          Failed
        </Badge>
      </DemoBlock>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p id={`${idPrefix}-trim`} className="text-small">
            Trimming pauses, 60%
          </p>
          <Progress value={60} aria-labelledby={`${idPrefix}-trim`} />
        </div>
        <div className="space-y-2">
          <p id={`${idPrefix}-upload`} className="text-small">
            Uploading (time unknown)
          </p>
          <Progress aria-labelledby={`${idPrefix}-upload`} />
        </div>
      </div>
      <DemoBlock title="Skeletons (static under reduced motion)">
        <div
          className="flex w-full max-w-sm items-center gap-3"
          role="status"
          aria-busy="true"
          aria-label="Loading take"
        >
          <Skeleton className="aspect-video w-28" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </DemoBlock>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My take</CardTitle>
            <CardDescription>
              <span className="mono">04:12</span> · uploaded 3 Dec
            </CardDescription>
          </CardHeader>
          <CardContent className="text-small">
            A card: white surface, soft shadow, 10 px corners.
          </CardContent>
          <CardFooter>
            <Button size="sm">Open</Button>
          </CardFooter>
        </Card>
        <div className="space-y-4">
          <Tabs defaultValue="transcript">
            <TabsList>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="cuts">Cuts</TabsTrigger>
              <TabsTrigger value="export" disabled>
                Export
              </TabsTrigger>
            </TabsList>
            <TabsContent value="transcript" className="pt-3 text-small">
              Transcript tab panel.
            </TabsContent>
            <TabsContent value="cuts" className="pt-3 text-small">
              Cuts tab panel.
            </TabsContent>
          </Tabs>
          <DemoBlock title="Avatars">
            <Avatar>
              <AvatarFallback>TO</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>MS</AvatarFallback>
            </Avatar>
          </DemoBlock>
        </div>
      </div>
    </DemoGroup>
  );
}
