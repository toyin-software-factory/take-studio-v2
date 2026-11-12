/**
 * Constraint and index names that code checks by name (SQLSTATE plus constraint name), kept as
 * one constant each so the schema that creates the constraint and the check that catches its
 * violation cannot drift apart (HRF-T10).
 */

/** The partial unique index that allows one queued or running job per take (AC-4). */
export const ONE_ACTIVE_JOB_INDEX = "processing_job_one_active_per_take_uidx";
