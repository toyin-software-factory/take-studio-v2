import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger, task } from "@trigger.dev/sdk";
import { count } from "drizzle-orm";
import { withJobDb } from "@/db/client/job";
import { user } from "@/db/schema";
import { parseJobEnv } from "@/lib/env";

const run = promisify(execFile);

/**
 * Scaffold smoke task: proves the job worker has ffmpeg 7, can import the shared
 * Drizzle schema, and can reach Neon over the pooled URL. Output carries no content.
 */
export const helloTask = task({
  id: "hello",
  machine: "small-1x",
  maxDuration: 60,
  run: async () => {
    const env = parseJobEnv();
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const { stdout } = await run(ffmpegPath, ["-version"]);
    const ffmpegVersion = stdout.split("\n")[0] ?? "";

    const userCount = await withJobDb(env.DATABASE_URL, async (db) => {
      const [row] = await db.select({ value: count() }).from(user);
      return row?.value ?? 0;
    });

    logger.info("hello task finished", { ffmpegVersion, userCount });
    return { ffmpegVersion, userCount };
  },
});
