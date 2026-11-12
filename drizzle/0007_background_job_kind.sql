-- HRF-T08: a background change is its own job kind. The new check is a superset of the old one,
-- so old code keeps working and every existing row passes it.
--
-- No backfill on purpose: a `rerender` row cannot be told apart afterwards. The old rule ("no
-- `trim` step") matches every re render, because a `rerender` never has a `trim` step row
-- (`updateStep` only updates rows that exist). Existing `rerender` rows stay as they are and the
-- code treats a `rerender` as a possible background change until a later cleanup task converts
-- them with a rule that is proven on the data.
ALTER TABLE "processing_job" DROP CONSTRAINT "processing_job_kind_check";--> statement-breakpoint
ALTER TABLE "processing_job" ADD CONSTRAINT "processing_job_kind_check" CHECK ("processing_job"."kind" IN ('initial', 'rerender', 'background', 'transcribe', 'reanalyse'));
