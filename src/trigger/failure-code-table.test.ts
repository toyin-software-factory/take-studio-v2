import { describe, expect, it } from "vitest";
import { ONE_ACTIVE_JOB_INDEX } from "@/db/schema/constraint-names";
import { DeadlineExceeded } from "@/lib/deadline";
import type { FailureCode } from "@/lib/failure-codes";
import { JOB_ERROR_NAMES } from "@/lib/job-errors";
import { BackgroundMissingError } from "./keying";
import { MediaToolError } from "./media";
import { failureCodeFor } from "./process-take";
import {
  DeepgramError,
  DeepgramRejected,
  DeepgramTimeout,
  transcribeFailureCode,
} from "./transcribe-take";

/**
 * HRF-T10: every error a job can end on, thrown through every task's error mapper, with the
 * failure code it must give. A failure hook can receive the error as a class instance or as a
 * plain `{ name, message }` copy, so each row runs both. If a class is renamed without its name
 * constant (`JOB_ERROR_NAMES`), or a mapper stops recognising one, a row here fails instead of
 * the job quietly ending as `internal_error`.
 */
type Row = {
  readonly label: string;
  readonly make: () => Error;
  /** Codes when the error arrives as the class instance. */
  readonly processTake: FailureCode;
  readonly transcribe: FailureCode;
  /** Codes when only `{ name, message }` survives (a copy has no class to test with instanceof). */
  readonly processTakeCopy: FailureCode;
  readonly transcribeCopy: FailureCode;
};

const ROWS: readonly Row[] = [
  {
    label: "DeadlineExceeded",
    make: () => new DeadlineExceeded(),
    processTake: "timeout",
    transcribe: "timeout",
    processTakeCopy: "timeout",
    transcribeCopy: "timeout",
  },
  {
    label: "BackgroundMissingError",
    make: () => new BackgroundMissingError(),
    processTake: "background_missing",
    transcribe: "background_missing",
    processTakeCopy: "background_missing",
    transcribeCopy: "background_missing",
  },
  {
    label: "MediaToolError (ffmpeg, exit 1)",
    make: () => new MediaToolError("ffmpeg", 1, false),
    processTake: "ffmpeg_error",
    transcribe: "ffmpeg_error",
    processTakeCopy: "ffmpeg_error",
    transcribeCopy: "ffmpeg_error",
  },
  {
    label: "MediaToolError (ffprobe, timed out)",
    make: () => new MediaToolError("ffprobe", null, true),
    processTake: "ffmpeg_error",
    transcribe: "ffmpeg_error",
    processTakeCopy: "ffmpeg_error",
    transcribeCopy: "ffmpeg_error",
  },
  {
    label: "DeepgramError (429)",
    make: () => new DeepgramError(429),
    processTake: "internal_error",
    transcribe: "provider_error",
    processTakeCopy: "internal_error",
    transcribeCopy: "provider_error",
  },
  {
    label: "DeepgramError (network)",
    make: () => new DeepgramError(null),
    processTake: "internal_error",
    transcribe: "provider_error",
    processTakeCopy: "internal_error",
    transcribeCopy: "provider_error",
  },
  {
    label: "DeepgramTimeout",
    make: () => new DeepgramTimeout(),
    processTake: "internal_error",
    transcribe: "timeout",
    processTakeCopy: "internal_error",
    transcribeCopy: "timeout",
  },
  {
    label: "DeepgramRejected (400)",
    make: () => new DeepgramRejected(400),
    processTake: "internal_error",
    transcribe: "provider_rejected",
    processTakeCopy: "internal_error",
    transcribeCopy: "provider_rejected",
  },
  {
    label: "Trigger.dev max duration error (text only, not ours to rename)",
    make: () => new Error("Run exceeded maxDuration of 2400 seconds"),
    processTake: "timeout",
    transcribe: "timeout",
    processTakeCopy: "timeout",
    transcribeCopy: "timeout",
  },
  {
    label: "any other error",
    make: () => new Error("boom"),
    processTake: "internal_error",
    transcribe: "internal_error",
    processTakeCopy: "internal_error",
    transcribeCopy: "internal_error",
  },
];

const plainCopy = (error: Error) => ({ name: error.name, message: error.message });

describe("every job error maps to its failure code (HRF-T10)", () => {
  for (const row of ROWS) {
    it(`${row.label}: process-take and transcribe-take, as an instance and as a plain copy`, () => {
      expect(failureCodeFor(row.make())).toBe(row.processTake);
      expect(transcribeFailureCode(row.make())).toBe(row.transcribe);
      expect(failureCodeFor(plainCopy(row.make()))).toBe(row.processTakeCopy);
      expect(transcribeFailureCode(plainCopy(row.make()))).toBe(row.transcribeCopy);
    });
  }

  it("a value that is not an error is an internal_error in both tasks", () => {
    for (const value of [undefined, null, "boom", 42, {}]) {
      expect(failureCodeFor(value)).toBe("internal_error");
      expect(transcribeFailureCode(value)).toBe("internal_error");
    }
  });

  it("covers every code each task can produce from a thrown error", () => {
    const processTake = new Set(ROWS.map((r) => r.processTake));
    const transcribe = new Set(ROWS.map((r) => r.transcribe));
    expect([...processTake].sort()).toEqual(
      ["background_missing", "ffmpeg_error", "internal_error", "timeout"].sort(),
    );
    expect([...transcribe].sort()).toEqual(
      [
        "background_missing",
        "ffmpeg_error",
        "internal_error",
        "provider_error",
        "provider_rejected",
        "timeout",
      ].sort(),
    );
  });

  it("every class carries the name the mappers compare against, and every name has a row", () => {
    const names = ROWS.map((r) => r.make().name);
    for (const name of Object.values(JOB_ERROR_NAMES)) expect(names).toContain(name);
    expect(new DeadlineExceeded().name).toBe(JOB_ERROR_NAMES.deadlineExceeded);
    expect(new BackgroundMissingError().name).toBe(JOB_ERROR_NAMES.backgroundMissing);
    expect(new MediaToolError("ffmpeg", 1, false).name).toBe(JOB_ERROR_NAMES.mediaTool);
    expect(new DeepgramError(null).name).toBe(JOB_ERROR_NAMES.deepgramError);
    expect(new DeepgramTimeout().name).toBe(JOB_ERROR_NAMES.deepgramTimeout);
    expect(new DeepgramRejected(400).name).toBe(JOB_ERROR_NAMES.deepgramRejected);
  });
});

describe("constraint names checked in code", () => {
  it("the one active job index name is one constant, shared by the schema and the check", () => {
    expect(ONE_ACTIVE_JOB_INDEX).toBe("processing_job_one_active_per_take_uidx");
  });
});
