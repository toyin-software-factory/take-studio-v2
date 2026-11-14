/**
 * Refreshes the recorded model answers (spec 0017, AC-10): `pnpm cut-quality:record`. Runs the
 * real model once per written case with the production request and writes the answer to
 * `tests/cut-quality/answers/<case id>.json`. LOCAL ONLY, with a real ANTHROPIC_API_KEY in your
 * shell where the key works (agent sandboxes cannot: C-29). It refuses to run in CI or in
 * Trigger.dev, and `--only <case id>` refreshes one case. An answer that cannot be parsed, is
 * refused by `validateAiEdit` or has dropped items is not written (the old file stays). It prints
 * case IDs and counts only, never a word or a reason. The cases are invented, but the habit keeps
 * the output safe to paste.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI_EDIT, aiEditAnswerSchema, buildAiRequest, validateAiEdit } from "../src/lib/ai-edit";
import { cutCaseSchema } from "../src/lib/cut-quality";
import { callClaude } from "../src/trigger/take-run/ai-call";
import { CASE_ENTRIES } from "../tests/cut-quality/cases";

const inCloud = ["CI", "TRIGGER_SECRET_KEY", "TRIGGER_RUN_ID", "TRIGGER_API_URL"].filter(
  (name) => Boolean(process.env[name]) && process.env[name] !== "false",
);
if (inCloud.length > 0) {
  console.error(
    `cut-quality:record runs on a developer machine only. Refusing: ${inCloud.join(", ")} is set.`,
  );
  process.exit(1);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("cut-quality:record needs ANTHROPIC_API_KEY in your shell.");
  process.exit(1);
}
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex === -1 ? null : (process.argv[onlyIndex + 1] ?? "");

const answersDir = resolve(import.meta.dirname, "../tests/cut-quality/answers");
let written = 0;
let kept = 0;

for (const entry of CASE_ENTRIES) {
  const parsed = cutCaseSchema.safeParse(entry.raw);
  if (!parsed.success) {
    console.error(
      "a case in tests/cut-quality/cases/index.ts fails its schema; run the unit tests",
    );
    process.exit(1);
  }
  const c = parsed.data;
  if (only !== null && c.id !== only) continue;
  const candidates = c.pauses.map((p) => ({ ...p, reason: "Pause" }));
  const request = buildAiRequest({ words: c.words, candidates, durationMs: c.durationMs });
  const verdict = await (async (): Promise<string> => {
    try {
      const result = await callClaude(request, apiKey, AbortSignal.timeout(AI_EDIT.deadlineMs));
      if (result.stopReason !== "end_turn" || result.text === null) return "unusable_answer";
      const answer = aiEditAnswerSchema.safeParse(JSON.parse(result.text));
      if (!answer.success) return "unusable_answer";
      const valid = validateAiEdit(answer.data, c.words, candidates, c.durationMs);
      if (!valid.ok || valid.data.dropped > 0) return "refused_by_validator";
      writeFileSync(
        resolve(answersDir, `${c.id}.json`),
        `${JSON.stringify(answer.data, null, 2)}\n`,
      );
      return "written";
    } catch (error) {
      // The cause name only: an SDK error can carry request text.
      return error instanceof Error && "cause" in error ? String(error.cause) : "call_failed";
    }
  })();
  if (verdict === "written") written += 1;
  else kept += 1;
  console.log(`cut-quality:record ${c.id}: ${verdict}`);
}
console.log(`cut-quality:record: ${written} written, ${kept} left as they were`);
if (only !== null && written + kept === 0) {
  console.error("no case has that id");
  process.exit(1);
}
