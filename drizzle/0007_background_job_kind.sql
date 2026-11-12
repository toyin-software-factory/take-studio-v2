ALTER TABLE "processing_job" DROP CONSTRAINT "processing_job_kind_check";--> statement-breakpoint
ALTER TABLE "processing_job" ADD CONSTRAINT "processing_job_kind_check" CHECK ("processing_job"."kind" IN ('initial', 'rerender', 'background', 'transcribe', 'reanalyse'));--> statement-breakpoint
-- Backfill: a background change used to be a `rerender` recognised by a hidden rule (no `trim`
-- step). Apply that same rule once, to FINISHED rows only (succeeded, failed, cancelled), so the
-- history carries the new kind. A queued or running row is never touched: an older process-take
-- may still be running it as a `rerender`. A finished re render that failed before its trim step
-- was written (for example `trigger_failed`) cannot be told apart and is counted as a background
-- change, as the hourly limit already did. The new code still treats a leftover `rerender` on a
-- take that is not `processing` as a background change until a later cleanup removes that branch.
UPDATE "processing_job" AS j SET "kind" = 'background'
WHERE j."kind" = 'rerender'
  AND j."status" IN ('succeeded', 'failed', 'cancelled')
  AND NOT EXISTS (SELECT 1 FROM "job_step" AS s WHERE s."job_id" = j."id" AND s."name" = 'trim');
