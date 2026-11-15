import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { storageDeletion, take } from "@/db/schema";
import { previewKey } from "@/lib/background-preview";
import { DeadlineExceeded } from "@/lib/deadline";
import { type PreviewIo, makePreview } from "./preview-background";
import { GRAY_FRAME, pending, fakeIo, rowOf, db, registerDb } from "./preview-background.support";

registerDb();

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
