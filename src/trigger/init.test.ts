import { beforeAll, describe, expect, it, vi } from "vitest";

// The global failure hook in `init.ts` (spec 0005 AC-3, spec 0007 AC-8): one Sentry event per
// final failure, with the status code tag and IDs only, and a flush before the process ends.
const hoisted = vi.hoisted(() => ({
  hook: null as null | ((args: unknown) => Promise<void>),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: hoisted.captureException,
  flush: hoisted.flush,
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    onFailure: (fn: (args: unknown) => Promise<void>) => {
      hoisted.hook = fn;
    },
  },
}));

beforeAll(async () => {
  await import("./init");
});

const JOB_ID = "11111111-1111-4111-8111-111111111111";

describe("tasks.onFailure in init.ts", () => {
  it("registers the hook once", () => {
    expect(hoisted.hook).toBeTypeOf("function");
  });

  it("raises one Sentry event for a rejected Deepgram request, tagged with the status code and IDs only", async () => {
    hoisted.captureException.mockClear();
    hoisted.flush.mockClear();
    const error = Object.assign(new Error("Deepgram rejected the request: transcript text here"), {
      status: 402,
    });
    await hoisted.hook?.({
      task: "transcribe-take",
      ctx: { run: { id: "run_abc" }, attempt: { number: 1 } },
      payload: { jobId: JOB_ID, text: "secret words" },
      error,
    });
    expect(hoisted.captureException).toHaveBeenCalledTimes(1);
    const [captured, context] = hoisted.captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(captured).toBe(error);
    expect(context.tags).toMatchObject({
      task: "transcribe-take",
      runId: "run_abc",
      attempt: "1",
      providerStatus: "402",
    });
    // IDs, counts and status codes only: no payload text, no error message in the tags.
    expect(JSON.stringify(context.tags)).not.toContain("secret words");
    expect(JSON.stringify(context.tags)).not.toContain("transcript text");
    expect(hoisted.flush).toHaveBeenCalledTimes(1);
  });

  it("adds no status tag when the error carries no numeric status", async () => {
    hoisted.captureException.mockClear();
    await hoisted.hook?.({
      task: "transcribe-take",
      ctx: { run: { id: "run_def" }, attempt: { number: 3 } },
      payload: { jobId: JOB_ID },
      error: new Error("boom"),
    });
    const [, context] = hoisted.captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(context.tags).not.toHaveProperty("providerStatus");
  });
});
