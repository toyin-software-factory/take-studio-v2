import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { SETUP_MESSAGES, type SetupFailure } from "@/lib/recorder-rules";

/** The messages above the Script step: used up allowance, a failed phone upload, a setup failure. */
export function SetupNotices({
  failure,
  usedUp,
  uploadNote,
}: {
  readonly failure: SetupFailure | null;
  readonly usedUp: string | null;
  readonly uploadNote: string | null;
}) {
  const message = failure ? SETUP_MESSAGES[failure] : null;
  return (
    <div className="flex flex-col gap-4 empty:hidden">
      {usedUp ? (
        <Alert variant="danger" title="No recording time left">
          {usedUp}{" "}
          <Link href="/library" className="underline">
            Back to your library
          </Link>
        </Alert>
      ) : null}
      {uploadNote ? (
        <Alert variant="danger" title="That file was not uploaded">
          {uploadNote} Choose the file again to retry.
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="danger" title={message.title}>
          {message.body}{" "}
          <Link href="/library" className="underline">
            Upload a file instead
          </Link>
        </Alert>
      ) : null}
    </div>
  );
}
