import { FileText, Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * "Download text" and "Download captions (SRT)" (spec 0007, AC-4). Plain links to the download
 * route, which sends attachments named after the take; `v` only busts caches.
 */
export function TranscriptDownloads({
  takeId,
  version,
}: {
  readonly takeId: string;
  readonly version: string | undefined;
}) {
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <a href={`/api/takes/${takeId}/transcript/txt${query}`} download>
          <Icon icon={FileText} size="badge" />
          Download text
        </a>
      </Button>
      <Button asChild variant="secondary">
        <a href={`/api/takes/${takeId}/transcript/srt${query}`} download>
          <Icon icon={Captions} size="badge" />
          Download captions (SRT)
        </a>
      </Button>
    </div>
  );
}
