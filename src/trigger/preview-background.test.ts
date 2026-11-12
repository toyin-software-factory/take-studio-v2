import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completePreview, requestPreview } from "@/db/data/previews";
import {
  background,
  backgroundPreview,
  processingJob,
  render,
  storageDeletion,
  take,
} from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { previewKey } from "@/lib/background-preview";
import { DeadlineExceeded } from "@/lib/deadline";
import { type RawFrame } from "@/lib/keying";
import { type PreviewIo, makePreview } from "./preview-background";

/** Spec 0008, build step 4: the preview job, with R2 and ffmpeg faked. */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const W = 320;
const H = 180;
/** A 320x180 frame of one colour with a person shaped patch in the middle. */
function frame(border: [number, number, number]): RawFrame {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x > W * 0.3 && x < W * 0.7 && y > H * 0.15;
      const c = inside ? [222, 160, 130] : border;
      const i = (y * W + x) * 3;
      data.set(c, i);
    }
  }
  return { width: W, height: H, data };
}
const GREEN_FRAME = frame([0, 177, 64]);
const GRAY_FRAME = frame([120, 120, 125]);

async function seedBackground() {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: "Studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
    })
    .returning();
  return row!;
}

async function pending(opts: { keyedRender?: boolean } = {}) {
  const bg = await seedBackground();
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, {
    status: "ready",
    durationMs: 10_000,
    width: 1920,
    height: 1080,
  });
  if (opts.keyedRender) {
    const jobId = crypto.randomUUID();
    await db.insert(processingJob).values({
      id: jobId,
      takeId: t.id,
      kind: "initial",
      status: "succeeded",
      secondsCharged: 10,
    });
    await db.insert(render).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      jobId,
      status: "succeeded",
      videoKey: "k",
      durationMs: 9000,
      removedRanges: [],
      isLatest: true,
      backgroundId: bg.id,
      backgroundName: "Studio",
      keyed: true,
      keyColor: "#12ab34",
    });
  }
  const made = await requestPreview(db, {
    creatorId: creator.id,
    takeId: t.id,
    backgroundId: bg.id,
  });
  if (!made.ok) throw new Error(made.error);
  return { bg, creator, take: t, preview: made.data.preview };
}

function fakeIo(
  over: Partial<PreviewIo> & {
    frame?: RawFrame;
    keyedShare?: number;
    /** The keyed still is just the background in the final gate (the person is gone). */
    onlyBackground?: boolean;
    onEncode?: () => Promise<void>;
  } = {},
) {
  const puts: { key: string; type: string; bytes: number }[] = [];
  const deleted: string[] = [];
  const sampled = vi.fn(async () => over.frame ?? GREEN_FRAME);
  const keyedShares = vi.fn(async () => over.keyedShare ?? 0.45);
  const encodes: (readonly string[])[] = [];
  const io: PreviewIo = {
    r2: {
      presignGet: async (key) => `https://r2.test/${key}?X-Amz-Signature=SECRET`,
      putObject: async (key, body, type) => {
        puts.push({ key, type, bytes: body.byteLength });
      },
      deleteObject: async (key) => {
        deleted.push(key);
      },
    },
    probe: async () =>
      ({
        durationMs: 10_000,
        width: 1920,
        height: 1080,
        container: "mp4",
        hasAudio: true,
        fps: 30,
        hdrTransfer: null,
      }) as never,
    sampleFrame: sampled,
    sampleKeyedShare: keyedShares,
    // The final gate reads the still, then the background (the only one read over HTTP). A normal
    // still differs from the background in the centre third; a person-less one does not.
    readImage: async (args, size) => {
      const isBackground = args.includes("-reconnect");
      const data = new Uint8Array(size.width * size.height * 3);
      if (!isBackground && !over.onlyBackground) data.fill(200);
      return { width: size.width, height: size.height, data };
    },
    encode: async (args) => {
      encodes.push(args);
      await over.onEncode?.();
      const out = args[args.length - 1]!;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(out, "jpeg-bytes");
    },
    ...(over.probe ? { probe: over.probe } : {}),
  };
  return { io, puts, deleted, sampled, encodes };
}

const rowOf = async (id: string) =>
  (await db.select().from(backgroundPreview).where(eq(backgroundPreview.id, id)))[0];

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

describe("makePreview (AC-4)", () => {
  it("detects the green on the frame, keys onto the background and writes the file", async () => {
    const { take: t, preview } = await pending();
    const { io, puts, sampled, encodes } = fakeIo();
    expect(await makePreview(db, preview.id, io)).toEqual({
      outcome: "ready",
      noGreenScreen: false,
    });
    expect(sampled).toHaveBeenCalledTimes(1);
    expect(puts).toEqual([{ key: previewKey(t.id, preview.id), type: "image/jpeg", bytes: 10 }]);
    expect(await rowOf(preview.id)).toMatchObject({
      status: "ready",
      noGreenScreen: false,
      objectKey: previewKey(t.id, preview.id),
    });
    const args = encodes[0]!.join(" ");
    // Seeks to the thumbnail's time through the URL, keys with the detected colour, no download.
    expect(args).toContain("-ss 1.000");
    expect(args).toContain("chromakey=0x00b140");
    expect(args).toContain("scale=1280:720");
    expect(args).toContain("-frames:v 1");
  });

  it("reuses the latest render's key colour and does not detect again", async () => {
    const { preview } = await pending({ keyedRender: true });
    const { io, sampled, encodes } = fakeIo();
    await makePreview(db, preview.id, io);
    expect(sampled).not.toHaveBeenCalled();
    expect(encodes[0]!.join(" ")).toContain("chromakey=0x12ab34");
  });

  it("shows the plain frame when the key would erase the person (S3S-T10)", async () => {
    // A key that makes 98 % of the frame transparent removed the subject with the screen.
    const { preview } = await pending({ keyedRender: true });
    const { io, encodes } = fakeIo({ keyedShare: 0.98 });
    expect(await makePreview(db, preview.id, io)).toEqual({
      outcome: "ready",
      noGreenScreen: true,
    });
    expect(encodes[0]!.join(" ")).not.toContain("chromakey");
  });

  it("never records a Ready still of only the background: plain frame, no green screen, IDs only logged (S3S-T12)", async () => {
    const { preview } = await pending();
    const { io, encodes, puts } = fakeIo({ onlyBackground: true });
    expect(await makePreview(db, preview.id, io)).toEqual({
      outcome: "ready",
      noGreenScreen: true,
    });
    // The keyed graph ran first, the gate caught it, and the plain frame was encoded after it.
    expect(encodes).toHaveLength(2);
    expect(encodes[0]!.join(" ")).toContain("chromakey");
    expect(encodes[1]!.join(" ")).not.toContain("chromakey");
    expect(puts).toHaveLength(1);
    expect((await rowOf(preview.id))?.noGreenScreen).toBe(true);
  });

  it("keeps a keyed still that differs from the background (S3S-T12)", async () => {
    const { preview } = await pending();
    const { io, encodes } = fakeIo();
    expect(await makePreview(db, preview.id, io)).toMatchObject({ noGreenScreen: false });
    expect(encodes).toHaveLength(1);
  });

  it("does not reuse a latest render key that is too close to neutral, and detects again (S3S-T10)", async () => {
    const { preview } = await pending({ keyedRender: true });
    const { io, sampled } = fakeIo({ frame: GRAY_FRAME });
    // The stored key colour is changed to a near grey green, which cannot be told from grey.
    const { render } = await import("@/db/schema");
    await db.update(render).set({ keyColor: "#a0a8a2" });
    expect(await makePreview(db, preview.id, io)).toMatchObject({ noGreenScreen: true });
    expect(sampled).toHaveBeenCalled();
  });

  it("flags a take with no green screen and shows its plain frame", async () => {
    const { preview } = await pending();
    const { io, puts, encodes } = fakeIo({ frame: GRAY_FRAME });
    expect(await makePreview(db, preview.id, io)).toEqual({
      outcome: "ready",
      noGreenScreen: true,
    });
    expect((await rowOf(preview.id))?.noGreenScreen).toBe(true);
    expect(puts).toHaveLength(1);
    const args = encodes[0]!.join(" ");
    expect(args).not.toContain("chromakey");
    expect(args).toContain("-vf scale=1280:720,format=yuvj420p");
  });

  it("does nothing for a preview that is not making, or does not exist", async () => {
    const { preview } = await pending();
    const first = fakeIo();
    await makePreview(db, preview.id, first.io);
    const again = fakeIo();
    expect(await makePreview(db, preview.id, again.io)).toEqual({ outcome: "skipped" });
    expect(again.puts).toHaveLength(0);
    expect(await makePreview(db, crypto.randomUUID(), again.io)).toEqual({ outcome: "skipped" });
  });

  it("writes nothing when the take is deleted before the file is written", async () => {
    const { take: t, preview } = await pending();
    const { io, puts, deleted } = fakeIo({
      onEncode: async () => {
        await db.delete(take).where(eq(take.id, t.id));
      },
    });
    expect(await makePreview(db, preview.id, io)).toEqual({ outcome: "gone" });
    expect(puts).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    expect(await rowOf(preview.id)).toBeUndefined();
  });

  it("removes the file it wrote when the row vanishes during the upload", async () => {
    const { take: t, preview } = await pending();
    const base = fakeIo();
    const io: PreviewIo = {
      ...base.io,
      r2: {
        ...base.io.r2,
        putObject: async (key, body, type) => {
          await base.io.r2.putObject(key, body, type);
          // The take is deleted while the file is being uploaded.
          await db.delete(take).where(eq(take.id, t.id));
        },
      },
    };
    expect(await makePreview(db, preview.id, io)).toEqual({ outcome: "gone" });
    expect(base.puts).toHaveLength(1);
    expect(base.deleted).toEqual([previewKey(t.id, preview.id)]);
  });

  it("queues the file for deletion when removing it fails", async () => {
    const { take: t, preview } = await pending();
    const base = fakeIo();
    const io: PreviewIo = {
      ...base.io,
      r2: {
        ...base.io.r2,
        putObject: async () => {
          await db.delete(take).where(eq(take.id, t.id));
        },
        deleteObject: async () => {
          throw new Error("R2 down");
        },
      },
    };
    expect(await makePreview(db, preview.id, io)).toEqual({ outcome: "gone" });
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toContain(previewKey(t.id, preview.id));
  });

  it("stops without writing when the deadline fires", async () => {
    const { preview } = await pending();
    const controller = new AbortController();
    const { io, puts } = fakeIo({
      onEncode: async () => {
        controller.abort(new DeadlineExceeded());
      },
    });
    await expect(makePreview(db, preview.id, io, controller.signal)).rejects.toBeInstanceOf(
      DeadlineExceeded,
    );
    expect(puts).toHaveLength(0);
    expect((await rowOf(preview.id))?.status).toBe("making");
  });

  it("throws, leaving the row making for the retry, when ffmpeg fails", async () => {
    const { preview } = await pending();
    const io: PreviewIo = {
      ...fakeIo().io,
      encode: async () => {
        throw new Error("ffmpeg failed (exit 1)");
      },
    };
    await expect(makePreview(db, preview.id, io)).rejects.toThrow("ffmpeg failed");
    expect((await rowOf(preview.id))?.status).toBe("making");
  });

  it("never puts the presigned link in a log line or the outcome", async () => {
    const { logger } = await import("@trigger.dev/sdk");
    const spies = [vi.spyOn(logger, "info"), vi.spyOn(logger, "warn"), vi.spyOn(logger, "error")];
    const { preview } = await pending();
    const { io } = fakeIo();
    const result = await makePreview(db, preview.id, io);
    const seen = JSON.stringify([...spies.flatMap((s) => s.mock.calls), result]);
    expect(seen).not.toContain("SECRET");
    expect(seen).not.toContain("r2.test");
    expect(seen).not.toContain("originals/");
    spies.forEach((s) => s.mockRestore());
  });
});
