import { eq } from "drizzle-orm";
import { afterAll, beforeAll, vi } from "vitest";
import { requestPreview } from "@/db/data/previews";
import { background, backgroundPreview, processingJob, render } from "@/db/schema";
import {
  type TestDb,
  createCreator,
  openTestDb,
  seedTake,
  builtInTracker,
} from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type RawFrame } from "@/lib/keying";
import { type PreviewIo } from "./preview-background";

/** Spec 0008, build step 4: the preview job, with R2 and ffmpeg faked. */
export let testDb: TestDb;
export let db: Db;
export const built = builtInTracker();

/** Opens the test database before the file's tests; removes the built in rows and closes it after. */
export function registerDb() {
  beforeAll(async () => {
    testDb = await openTestDb();
    db = testDb.db;
  });
  afterAll(async () => {
    if (testDb) await built.clean(testDb.db);
    await testDb?.close();
  });
}

export const W = 320;
export const H = 180;
/** A 320x180 frame of one colour with a person shaped patch in the middle. */
export function frame(border: [number, number, number]): RawFrame {
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
export const GREEN_FRAME = frame([0, 177, 64]);
export const GRAY_FRAME = frame([120, 120, 125]);

export async function seedBackground() {
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
  return built.track(row!);
}

export async function pending(opts: { keyedRender?: boolean } = {}) {
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

export function fakeIo(
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

export const rowOf = async (id: string) =>
  (await db.select().from(backgroundPreview).where(eq(backgroundPreview.id, id)))[0];
