import { beforeEach, describe, expect, it, vi } from "vitest";

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn(async () => ({ id: "run_1" })) }));
vi.mock("./notify-take", () => ({ notifyTakeTask: { trigger } }));
vi.mock("@trigger.dev/sdk", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { queueTakeEmail } from "./queue";

beforeEach(() => trigger.mockClear());

describe("queueTakeEmail (specs 0006, 0007, 0008: only the first run is emailed)", () => {
  it("queues the email for the first run", async () => {
    await queueTakeEmail("job_1", "initial");
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith({ jobId: "job_1" });
  });

  it("queues nothing for a re render (a background change shows its result on the page)", async () => {
    await queueTakeEmail("job_2", "rerender");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("queues nothing for a transcribe job, nor for a kind it doesn't know", async () => {
    await queueTakeEmail("job_3", "transcribe");
    await queueTakeEmail("job_4", "something_new");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("never throws when the trigger fails", async () => {
    trigger.mockRejectedValueOnce(new Error("down"));
    await expect(queueTakeEmail("job_5", "initial")).resolves.toBeUndefined();
  });
});
