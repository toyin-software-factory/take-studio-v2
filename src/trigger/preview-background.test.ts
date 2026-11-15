import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { completePreview } from "@/db/data/previews";
import { take } from "@/db/schema";
import { previewKey } from "@/lib/background-preview";
import { DeadlineExceeded } from "@/lib/deadline";
import { type PreviewIo, makePreview } from "./preview-background";
import { pending, fakeIo, rowOf, db, registerDb } from "./preview-background.support";

registerDb();

describe("makePreview and the deadline, retries and expiry (AC-4)", () => {
  it("does not record or clean up when the deadline fires during the upload", async () => {
    const { preview } = await pending();
    const controller = new AbortController();
    const base = fakeIo();
    const io: PreviewIo = {
      ...base.io,
      r2: {
        ...base.io.r2,
        putObject: async (key, body, type, options) => {
          await base.io.r2.putObject(key, body, type, options);
          controller.abort(new DeadlineExceeded());
        },
      },
    };
    await expect(makePreview(db, preview.id, io, controller.signal)).rejects.toBeInstanceOf(
      DeadlineExceeded,
    );
    expect(await rowOf(preview.id)).toMatchObject({ status: "making", objectKey: null });
    expect(base.deleted).toHaveLength(0);
  });

  it("passes the attempt's signal to the upload", async () => {
    const { preview } = await pending();
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const base = fakeIo();
    const io: PreviewIo = {
      ...base.io,
      r2: {
        ...base.io.r2,
        putObject: async (key, body, type, options) => {
          seen = options?.signal;
          await base.io.r2.putObject(key, body, type, options);
        },
      },
    };
    await makePreview(db, preview.id, io, controller.signal);
    expect(seen).toBe(controller.signal);
  });

  it("leaves the file alone when a retry already finished the row (superseded)", async () => {
    const { take: t, preview } = await pending();
    const base = fakeIo();
    const io: PreviewIo = {
      ...base.io,
      r2: {
        ...base.io.r2,
        putObject: async (key, body, type, options) => {
          await base.io.r2.putObject(key, body, type, options);
          // A retry finished the same row while this attempt was still uploading.
          await completePreview(db, { previewId: preview.id, noGreenScreen: false });
        },
      },
    };
    expect(await makePreview(db, preview.id, io)).toEqual({ outcome: "gone" });
    expect(base.deleted).toEqual([]);
    expect(await rowOf(preview.id)).toMatchObject({
      status: "ready",
      objectKey: previewKey(t.id, preview.id),
    });
  });

  it("does no work for an expired take, and removes the file when the take expires during the upload", async () => {
    const early = await pending();
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, early.take.id));
    const idle = fakeIo();
    expect(await makePreview(db, early.preview.id, idle.io)).toEqual({ outcome: "skipped" });
    expect(idle.encodes).toHaveLength(0);

    const late = await pending();
    const base = fakeIo();
    const io: PreviewIo = {
      ...base.io,
      r2: {
        ...base.io.r2,
        putObject: async (key, body, type, options) => {
          await base.io.r2.putObject(key, body, type, options);
          await db
            .update(take)
            .set({ videoExpiresAt: new Date(Date.now() - 1000) })
            .where(eq(take.id, late.take.id));
        },
      },
    };
    expect(await makePreview(db, late.preview.id, io)).toEqual({ outcome: "gone" });
    expect(base.deleted).toEqual([previewKey(late.take.id, late.preview.id)]);
    expect((await rowOf(late.preview.id))?.status).toBe("making");
  });
});
