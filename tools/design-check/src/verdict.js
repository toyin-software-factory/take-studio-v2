// Turns a round's findings and judge answers into a verdict, and keeps the loop's memory across
// rounds: the round count, and how many rounds in a row each failure has come back unchanged.
//
//   approved    nothing fails and nothing is uncertain
//   needs_fixes there are failures the builder should fix (feedback lists them)
//   needs_you   only stuck failures or low-confidence judge answers are left, or the round cap is hit
import fs from "node:fs";
import path from "node:path";

export function statePath(cfg) {
  return path.join(cfg.outDir, "state.json");
}
export function loadState(cfg) {
  try {
    return JSON.parse(fs.readFileSync(statePath(cfg), "utf8"));
  } catch {
    return { round: 0, history: {}, rounds: [] };
  }
}
export function saveState(cfg, st) {
  fs.mkdirSync(cfg.outDir, { recursive: true });
  fs.writeFileSync(statePath(cfg), JSON.stringify(st, null, 2));
}
export function resetState(cfg) {
  try {
    fs.rmSync(statePath(cfg));
  } catch {}
}

const sig = (f) => JSON.stringify([f.design, f.build]);

// Classifies everything in a round. Mutates and returns `st` when record is true.
export function judgeRound(cfg, result, st, { record = true } = {}) {
  const round = st.round + (record ? 1 : 0);
  const fails = [],
    flags = [],
    passes = [],
    info = [],
    setup = [];
  const nextHistory = {};
  for (const p of result.pages) {
    for (const f of p.findings) {
      const item = { ...f, page: p.name, key: `${p.name}|${f.id}` };
      if (f.severity === "info") {
        info.push(item);
        continue;
      }
      if (f.severity === "setup") {
        setup.push(item);
        continue;
      }
      const prev = st.history[item.key];
      const streak =
        !result.quick && prev && prev.sig === sig(f) && prev.round === st.round
          ? prev.streak + 1
          : 1;
      nextHistory[item.key] = { sig: sig(f), streak, round };
      item.streak = streak;
      if (streak >= cfg.repeatLimit) {
        item.stuck = true;
        flags.push({
          ...item,
          why: `came back unchanged ${streak} rounds in a row, so the builder probably cannot fix it alone`,
        });
      } else fails.push(item);
    }
    for (const q of p.questions) {
      const a = q.answer || { pass: null, confidence: 0, reason: "not answered" };
      const item = {
        id: q.id,
        key: `${p.name}|${q.id}`,
        page: p.name,
        viewport: q.viewport,
        label: q.label,
        kind: q.kind,
        question: q.question,
        answer: a,
        images: q.images,
      };
      if (a.pass === null || a.confidence < cfg.confidence)
        flags.push({
          ...item,
          why: `judge unsure (${Math.round((a.confidence || 0) * 100)}%): ${a.reason}`,
        });
      else if (a.pass) passes.push(item);
      else {
        const prev = st.history[item.key];
        const streak = prev && prev.round === st.round ? prev.streak + 1 : 1;
        nextHistory[item.key] = { sig: "judge", streak, round };
        if (streak >= cfg.repeatLimit)
          flags.push({
            ...item,
            stuck: true,
            why: `the judge failed this ${streak} rounds in a row: ${a.reason}`,
          });
        else
          fails.push({
            ...item,
            message: `${q.kind} does not match (${a.reason}). Question: ${q.question} Compare this section's design and build screenshots in the report.`,
          });
      }
    }
  }
  let status;
  if (setup.length) status = "needs_setup";
  else if (!fails.length && !flags.length) status = "approved";
  else if (!fails.length) status = "needs_you";
  else if (round >= cfg.maxRounds) status = "needs_you";
  else status = "needs_fixes";
  const verdict = {
    round,
    maxRounds: cfg.maxRounds,
    status,
    fails,
    flags,
    passes,
    info,
    setup,
    capped: fails.length > 0 && round >= cfg.maxRounds,
  };
  if (record && !result.quick) {
    st.round = round;
    st.history = nextHistory;
    st.rounds.push({ at: result.at, status, fails: fails.length, flags: flags.length });
  }
  return verdict;
}
