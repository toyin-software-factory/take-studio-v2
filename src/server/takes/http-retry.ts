import { dispatchJob } from "@/db/data/dispatch";
import type {} from "@/db/types";
import { isRetryable } from "@/lib/take-media";
import { limitExceededMessage } from "@/lib/usage-rules";
import { getForCreator } from ".";
import { recordEvent } from "../analytics/record";
import { hasActiveTranscribe } from "../transcripts";
import { start } from "../jobs";
import { PRIVATE_NO_STORE, usageForCreator, usageNumbers } from "../usage";
import { jobView } from "./views";
import {
  MESSAGES,
  STATUS,
  errorResponse,
  guard,
  json,
  type Creator,
  type TakeHttpDeps,
} from "./http-base";

/**
 * POST /api/takes/{id}/retry: a new run for a probed take that failed for a reason other
 * than its media (AC-10, spec 0002), including one cancelled while running. Media failures
 * and takes already processing get 409. `jobs.start` decides the charge, so a retry is not
 * charged again while an earlier initial charge stands.
 */
export async function handleRetry(
  request: Request,
  takeId: string,
  deps: TakeHttpDeps,
): Promise<Response> {
  const creator = await guard(request, deps, { checkOrigin: true });
  if (creator instanceof Response) return creator;
  const found = await getForCreator(creator.db, creator.creatorId, takeId);
  if (!found.ok) return errorResponse("not_found");
  const { take } = found.data;
  // One clock read per request (spec 0014): retryability, the charge and the usage numbers
  // all use the same instant, so a month boundary can't split them.
  const at = deps.now?.() ?? new Date();
  // Spec 0007: any job start waits for a running transcript, with its own message.
  if (await hasActiveTranscribe(creator.db, take.id)) return errorResponse("transcript_running");
  if (take.status === "processing") return errorResponse("job_in_progress");
  if (!isRetryable(take, at)) return errorResponse("not_retryable");

  // A missing USAGE_HASH_SECRET is a configuration problem: a friendly 503 before any job
  // starts (so nothing is charged), never a 500.
  let usageSecret: string;
  try {
    usageSecret = deps.usageSecret();
  } catch {
    return errorResponse("unavailable");
  }

  const started = await start(creator.db, {
    creatorId: creator.creatorId,
    takeId: take.id,
    usageSecret,
    now: at,
  });
  if (!started.ok) {
    if (started.error === "limit_exceeded") {
      // Spec 0016 AC-4: the first charge did not fit, after the upload was complete.
      await recordEvent(creator.db, {
        name: "limit_hit",
        creatorId: creator.creatorId,
        takeId: take.id,
        props: { place: "upload_complete" },
      });
      return limitExceededResponse(creator, take.videoExpiresAt, usageSecret, at);
    }
    return errorResponse(started.error === "invalid_transition" ? "not_retryable" : started.error);
  }
  const dispatched = await dispatchJob(creator.db, {
    jobId: started.data.id,
    trigger: deps.triggerProcessTake,
  });
  if (!dispatched.ok) return errorResponse("dispatch_failed");
  return json({ job: jobView(started.data) }, 202);
}

/**
 * A retry refused at the allowance (spec 0014 AC-6, AC-8): 403 with the dated message and the
 * four usage numbers, `private, no-store`. Nothing was charged. Falls back to the plain message
 * when the numbers can't be read.
 */
async function limitExceededResponse(
  creator: Creator,
  videoExpiresAt: Date | null,
  usageSecret: string,
  at: Date,
): Promise<Response> {
  const usage = await usageForCreator(creator.db, {
    creatorId: creator.creatorId,
    usageSecret,
    now: at,
  }).catch(() => null);
  if (!usage?.ok) return limitFallback();
  return Response.json(
    {
      error: "limit_exceeded",
      message: limitExceededMessage({ resetsOn: usage.data.resetsOn, videoExpiresAt }),
      ...usageNumbers(usage.data),
    },
    { status: STATUS.limit_exceeded, headers: PRIVATE_NO_STORE },
  );
}

/** The plain limit message, still `private, no-store` like every other limit_exceeded body. */
function limitFallback(): Response {
  return Response.json(
    { error: "limit_exceeded", message: MESSAGES.limit_exceeded },
    { status: STATUS.limit_exceeded, headers: PRIVATE_NO_STORE },
  );
}
