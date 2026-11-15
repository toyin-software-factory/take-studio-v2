/**
 * API level end to end pipeline test (spec 0004 build plan step 5, backend half).
 *
 *   pnpm test:pipeline
 *
 * Drives the real routes and tasks: POST /api/uploads → PUT parts to R2 → complete → probe →
 * process-take → GET /api/takes/{id} → media links, for every fixture, plus retry, ownership
 * and limits. Local Postgres (Docker), real R2 and Trigger.dev dev, local ffmpeg. Cleans up
 * through the real deletion path. Exits non zero when any check fails.
 * Pre release check, not PR CI: it needs R2 and Trigger.dev credentials (see README).
 *
 * The pieces: checks.ts (the check list), api.ts (upload and read helpers), fixtures.ts (the
 * fixture table), core.ts (limits, links, retry, ownership), cleanup.ts, and one file per spec.
 */
import { ensureBuiltInBackgrounds } from "@/trigger/built-in-backgrounds";
import { downloadRender, media, upload, waitFinal } from "./api";
import { aiEditMeasure } from "./ai-edit";
import { backgroundScenarios } from "./background";
import { changeScenarios } from "./changes";
import { check, report } from "./checks";
import { cleanupRun } from "./cleanup";
import { coreScenarios } from "./core";
import { FIXTURES, fixtureScenario } from "./fixtures";
import { db, pg, r2, startServices, stopServices } from "./harness";
import { createCreator } from "./creator";
import { transcriptScenarios } from "./transcript";
import { usageScenarios } from "./usage";

async function main() {
  console.log("Starting the app and trigger dev…");
  await startServices();
  const a = await createCreator("a");
  const b = await createCreator("b");
  const t = await createCreator("transcripts");
  const bg = await createCreator("backgrounds");
  const u = await createCreator("usage");
  // Recorded takes have their own creator: `a` is near the 10 uploads an hour limit already.
  const r = await createCreator("recordings");
  // The built in studios are in the local database and R2 (idempotent, like the deploy step).
  await ensureBuiltInBackgrounds(db, r2, { local: true });
  const takes: Record<string, string> = {};

  // PIPELINE_ONLY=background runs just the background scenarios (a lighter run for small machines).
  if (process.env.PIPELINE_ONLY === "background") {
    await backgroundScenarios({ c: bg, b, check, upload, waitFinal, downloadRender, media });
    return;
  }

  // PIPELINE_ONLY=usage runs just the monthly usage limit checks (spec 0014).
  if (process.env.PIPELINE_ONLY === "usage") {
    await usageScenarios({ c: u, check, upload, waitFinal });
    return;
  }

  // PIPELINE_ONLY=recorded runs just the recorded take fixtures (spec 0021 AC-4, AC-14).
  if (process.env.PIPELINE_ONLY === "recorded") {
    for (const [label, file, container, want] of FIXTURES) {
      if (want.recording) await fixtureScenario(r, label, file, container, want);
    }
    return;
  }

  // PIPELINE_ONLY=ai measures the transcript and AI edit time and tokens on a 10 minute take
  // (spec 0012, real Deepgram and Claude: only run it when told to; see tests/AGENTS.md).
  if (process.env.PIPELINE_ONLY === "ai") {
    await aiEditMeasure({ c: t, check, upload, waitFinal, media });
    return;
  }

  // PIPELINE_ONLY=changes runs just the waveform and cut change checks (spec 0011).
  if (process.env.PIPELINE_ONLY === "changes") {
    const wanted = ["pauses + A/V sync", "silent"];
    for (const [label, file, container, want] of FIXTURES) {
      if (!wanted.includes(label)) continue;
      takes[label] = await fixtureScenario(a, label, file, container, want);
    }
    const syncTake = takes["pauses + A/V sync"];
    if (!syncTake) throw new Error("the sync fixture did not run");
    await changeScenarios({
      a,
      takeId: syncTake,
      silentTakeId: takes["silent"],
      check,
      downloadRender,
    });
    return;
  }

  // AC-4, AC-6, AC-7: every fixture end to end.
  for (const [label, file, container, want] of FIXTURES) {
    try {
      takes[label] = await fixtureScenario(want.recording ? r : a, label, file, container, want);
    } catch (error) {
      check(label, "ran", false, String(error));
    }
  }

  await coreScenarios(a, b, takes);

  // Spec 0011: the waveform and a cut change render (AC-7, AC-11).
  const syncTake = takes["pauses + A/V sync"];
  if (syncTake) {
    try {
      await changeScenarios({
        a,
        takeId: syncTake,
        silentTakeId: takes["silent"],
        check,
        downloadRender,
      });
    } catch (error) {
      check("changes", "ran", false, String(error));
    }
  }

  // Spec 0007: transcripts end to end against real Deepgram (needs DEEPGRAM_API_KEY).
  // Spec 0008: backgrounds end to end (needs the built in studio, seeded above).
  await backgroundScenarios({
    c: bg,
    b,
    check,
    upload,
    waitFinal,
    downloadRender,
    media,
  });

  // Spec 0014: the monthly usage limit (the setting is restored at the end).
  await usageScenarios({ c: u, check, upload, waitFinal });

  await transcriptScenarios({
    a,
    t,
    b,
    check,
    upload,
    waitFinal,
    downloadRender,
    media,
    noAudioTakeId: takes.silent,
  });
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  // A bare "fetch failed" hides the reason (refused, reset, timeout): print the cause's code.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const code = cause ? ` (${(cause as NodeJS.ErrnoException).code ?? cause.message})` : "";
  check("harness", "run", false, `${String(error)}${code}`);
} finally {
  await cleanupRun();
  stopServices();
  await pg.end();
  exitCode = report() > 0 ? 1 : 0;
}
process.exit(exitCode);
