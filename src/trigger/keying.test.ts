import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { detectInFile } from "./keying";

/** S3S-T10: the guard on the real decode path. A key that would erase the subject is not used. */
describeWithFfmpeg("detectInFile guard (S3S-T10)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "keying-guard-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const facts = { durationMs: 2_000, width: 640, height: 360, hdrTransfer: null } as const;
  const clip = (name: string, source: string) => {
    const path = join(dir, name);
    const run = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        source,
        "-t",
        "2",
        "-r",
        "10",
        "-pix_fmt",
        "yuv420p",
        path,
      ],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    return path;
  };

  it("keys a normal green screen with a person on it", async () => {
    const path = clip(
      "person.mp4",
      "color=c=0x00b140:s=640x360,drawbox=x=220:y=60:w=200:h=300:color=0x7e5540:t=fill",
    );
    const result = await detectInFile(path, facts);
    expect(result.usable).toBe(true);
  });

  it("does not key a frame that is green all over: the key would remove everything", async () => {
    const path = clip("all-green.mp4", "color=c=0x7df54b:s=640x360");
    const result = await detectInFile(path, facts);
    expect(result).toMatchObject({ usable: false, reason: "erases_subject" });
  });
});
