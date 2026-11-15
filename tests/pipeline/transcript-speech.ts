/** Not English and no speech (AC-6, AC-7). Called from transcript.ts. */
import { type Ctx, rowsOf, waitTranscript } from "./transcript-env";

export async function speechScenarios(ctx: Ctx): Promise<string | undefined> {
  const { check } = ctx;
  const a = ctx.t;
  const S = "transcript";
  try {
    const es = await ctx.upload(a, "speech-es.mp4", "mp4");
    const t = await ctx.waitFinal(a, es);
    const v = await waitTranscript(a, es);
    check(
      S,
      "AC-6: Spanish take stays Ready, transcript skipped not_english",
      t.take.status === "ready" && v.state === "skipped" && v.reason === "not_english",
      { status: t.take.status, state: v.state, reason: v.reason },
    );
    check(S, "AC-6: no transcript stored", (await rowsOf(es)).length === 0, "");
    const dl = await a.raw("GET", `/api/takes/${es}/transcript/txt`);
    check(S, "AC-6: nothing to download (404)", dl.status === 404, dl.status);
  } catch (error) {
    check(S, "Spanish ran", false, String(error));
  }

  // No speech: AC-7, a silent audio track (Deepgram answers with no words) and no audio stream.
  let quiet: string | undefined;
  try {
    quiet = await ctx.upload(a, "speech-quiet.mp4", "mp4");
    await ctx.waitFinal(a, quiet);
    const v = await waitTranscript(a, quiet);
    check(
      S,
      "AC-7: silent audio track skipped no_speech",
      v.state === "skipped" && v.reason === "no_speech",
      { state: v.state, reason: v.reason },
    );
    if (ctx.noAudioTakeId) {
      const n = await waitTranscript(ctx.a, ctx.noAudioTakeId);
      check(
        S,
        "AC-7: a take with no audio stream skipped no_speech",
        n.state === "skipped" && n.reason === "no_speech",
        { state: n.state, reason: n.reason },
      );
    }
  } catch (error) {
    check(S, "No speech ran", false, String(error));
  }
  return quiet;
}
