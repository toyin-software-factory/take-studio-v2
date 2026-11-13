// The judge answers the questions code cannot settle. It is pluggable:
//
//   { "type": "jev" }   TypeSafe's Jev decision model (default: TypeSafe's own API, TYPESAFE_API_KEY). Gets the
//                       measured facts as text plus the two section screenshots ("images": false to skip them).
//   { "type": "command", "command": "jev judge" }   JSON on stdin, JSON on stdout (see README)
//   { "type": "http", "url": "http://127.0.0.1:9000/judge", "headers": {...} }   same JSON, POSTed
//   { "type": "anthropic", "model": "claude-opus-5-5" }   built-in fallback using the Claude API
//   { "type": "none" }   every question goes to you as low confidence
//
// Request:  { "questions": [ { "id", "question", "viewport", "label", "kind", "facts": {...},
//                               "images": [ { "role": "design"|"build"|"diff", "path" } ] } ] }
// Response: { "answers": [ { "id", "pass": true|false, "confidence": 0..1, "reason": "..." } ] }
import { spawn } from "node:child_process";
import fs from "node:fs";

export async function runJudge(cfg, questions) {
  if (!questions.length) return [];
  const j = cfg.judge || { type: "none" };
  try {
    if (j.type === "jev") return normalise(questions, await viaJev(j, questions));
    if (j.type === "command") return normalise(questions, await viaCommand(j, questions));
    if (j.type === "http") return normalise(questions, await viaHttp(j, questions));
    if (j.type === "anthropic") return normalise(questions, await viaAnthropic(j, questions));
  } catch (err) {
    return questions.map((q) => ({
      id: q.id,
      pass: null,
      confidence: 0,
      reason: `judge failed: ${String(err.message || err).slice(0, 200)}`,
    }));
  }
  return questions.map((q) => ({
    id: q.id,
    pass: null,
    confidence: 0,
    reason: "no judge configured",
  }));
}

function normalise(questions, res) {
  const answers = Array.isArray(res) ? res : res && res.answers;
  const byId = new Map((answers || []).map((a) => [a.id, a]));
  return questions.map((q) => {
    const a = byId.get(q.id);
    if (!a) return { id: q.id, pass: null, confidence: 0, reason: "judge gave no answer" };
    let c = Number(a.confidence);
    if (c > 1) c = c / 100;
    return {
      id: q.id,
      pass: typeof a.pass === "boolean" ? a.pass : null,
      confidence: isFinite(c) ? c : 0,
      reason: String(a.reason || "").slice(0, 400),
    };
  });
}

function viaCommand(j, questions) {
  return new Promise((ok, no) => {
    const p = spawn(j.command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(j.env || {}) },
    });
    let out = "",
      err = "";
    const timer = setTimeout(
      () => {
        p.kill();
        no(new Error("judge command timed out"));
      },
      (j.timeoutSec || 600) * 1000,
    );
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", no);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return no(new Error(`judge command exited ${code}: ${err.slice(-300)}`));
      try {
        const m = out.match(/\{[\s\S]*\}\s*$/);
        ok(JSON.parse(m ? m[0] : out));
      } catch {
        no(new Error("judge command did not print JSON"));
      }
    });
    p.stdin.on("error", () => {}); // e.g. EPIPE; the close handler reports the command's failure
    p.stdin.end(JSON.stringify({ questions }));
  });
}

// Credentials only travel over HTTPS (plain HTTP is allowed for this machine, e.g. a mock).
function secureUrl(u, what) {
  const url = new URL(u);
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error(`${what} must use https (got ${url.protocol}//${url.hostname})`);
  return url.toString();
}

async function viaHttp(j, questions) {
  const res = await fetch(secureUrl(j.url, "judge url"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(j.headers || {}) },
    body: JSON.stringify({ questions }),
    signal: AbortSignal.timeout((j.timeoutSec || 600) * 1000),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  return res.json();
}

// Built-in fallback: one atomic question per request, with the section images attached.
async function viaAnthropic(j, questions) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const { z } = await import("zod");
  const Answer = z.object({ pass: z.boolean(), confidence: z.number(), reason: z.string() });
  const client = new Anthropic();
  const answers = [];
  const limit = j.concurrency || 4;
  let i = 0;
  const worker = async () => {
    while (i < questions.length) {
      const q = questions[i++];
      const content = [];
      for (const img of q.images || []) {
        content.push({ type: "text", text: `${img.role.toUpperCase()} image:` });
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: fs.readFileSync(img.path).toString("base64"),
          },
        });
      }
      content.push({
        type: "text",
        text: `${q.question}\n\nYou are checking a built web page against its reference design. Answer only this one question. "pass" is true when the build matches the design on this point. "confidence" is 0 to 1: how sure you are. Give one short sentence of reason naming what differs, if anything.`,
      });
      try {
        const r = await client.messages.parse({
          model: j.model || "claude-opus-5-5",
          max_tokens: 4000,
          output_config: { effort: j.effort || "medium", format: zodOutputFormat(Answer) },
          messages: [{ role: "user", content }],
        });
        if (r.stop_reason === "refusal" || !r.parsed_output)
          answers.push({
            id: q.id,
            pass: null,
            confidence: 0,
            reason: "judge declined or returned no answer",
          });
        else answers.push({ id: q.id, ...r.parsed_output });
      } catch (err) {
        answers.push({
          id: q.id,
          pass: null,
          confidence: 0,
          reason: `judge error: ${String(err.message || err).slice(0, 160)}`,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, questions.length) }, worker));
  return { answers };
}

// Jev (TypeSafe's decision model) answers each question as a "noul": the probability that the
// statement holds. pass = p >= 0.5; confidence = max(p, 1 - p), so 0.5 is a coin flip.
// Questions that share the same facts go in one request, with the facts as `state`.
//
//   provider "typesafe" (default): POST https://api.typesafe.ai/v1/systemone, key in TYPESAFE_API_KEY,
//                                   model jev-1.14.0 (pinned; "jev-latest" also works)
//   provider "openrouter": POST https://openrouter.ai/api/alpha/decisions, key in OPENROUTER_API_KEY
//   provider "neon": Neon AI Gateway through the AI SDK (needs @neon/ai-sdk-provider@1.1.0 and ai@7.0.133)
async function viaJev(j, questions) {
  const groups = new Map();
  for (const q of questions) {
    const k = q.group || q.id;
    (groups.get(k) || groups.set(k, []).get(k)).push(q);
  }
  const answers = [];
  for (const list of groups.values()) {
    // Screenshots go with every visual question unless "images": false. If the request with
    // images is refused, ask again with the facts only; a purely visual question answered without
    // the pictures is then marked unsure, so it goes to Toyin instead of passing.
    const hasImages = list.some((q) => q.images && q.images.length);
    let withImages = j.provider !== "neon" && j.images !== false && hasImages;
    let probs;
    try {
      probs = j.provider === "neon" ? await jevNeon(j, list) : await jevHttp(j, list, withImages);
    } catch (err) {
      if (!withImages) throw err;
      withImages = false;
      probs = await jevHttp(j, list, false);
    }
    list.forEach((q, i) => {
      const p = probs[i];
      if (typeof p !== "number" || !isFinite(p))
        return answers.push({ id: q.id, pass: null, confidence: 0, reason: "Jev gave no answer" });
      const blind = q.visualOnly && !withImages;
      answers.push({
        id: q.id,
        pass: p >= 0.5,
        confidence: blind ? Math.min(0.5, Math.max(p, 1 - p)) : Math.max(p, 1 - p),
        reason: `Jev: chance it matches ${Math.round(p * 100)}%${blind ? " (judged without the screenshots)" : ""}`,
      });
    });
  }
  return { answers };
}

const CRITERIA = {
  true: "The build matches the design on this point closely enough that a careful designer would sign it off.",
  false: "A careful designer would see a difference on this point and ask for it to be fixed.",
};

async function jevHttp(j, list, withImages) {
  const or = j.provider === "openrouter";
  const url =
    j.url ||
    (or
      ? "https://openrouter.ai/api/alpha/decisions"
      : `${process.env.TYPESAFE_API_BASE || "https://api.typesafe.ai"}/v1/systemone`);
  const keyEnv = j.apiKeyEnv || (or ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY");
  const key = process.env[keyEnv];
  if (!key) throw new Error(`Jev needs an API key in ${keyEnv}`);
  secureUrl(url, "Jev endpoint");
  let state = list[0].facts || {};
  const assets = {};
  if (withImages) {
    // Images go in `assets` and are referenced from the state by their key in backticks.
    const refs = [];
    for (const img of list[0].images || []) {
      const ref = `${img.role}-image`;
      assets[ref] = {
        type: "image",
        format: "jpg",
        data_base64: fs.readFileSync(img.path).toString("base64"),
      };
      refs.push(`${img.role}: \`${ref}\``);
    }
    if (refs.length) state = { ...state, screenshots: refs.join("; ") };
  }
  const body = {
    model: j.model || (or ? "typesafe/jev-1.14" : "jev-1.14.0"),
    state,
    questions: Object.fromEntries(
      list.map((q, i) => [
        `q${i}`,
        { type: "noul", instructions: q.question, criteria: q.criteria || CRITERIA },
      ]),
    ),
    ...(Object.keys(assets).length ? { assets } : {}),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(j.headers || {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout((j.timeoutSec || 90) * 1000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  return list.map((_, i) => {
    const a = data.answers && data.answers[`q${i}`];
    return a
      ? typeof a.noul === "number"
        ? a.noul
        : typeof a.probability === "number"
          ? a.probability
          : null
      : null;
  });
}

async function jevNeon(j, list) {
  let neon, decide;
  try {
    ({ neon } = await import("@neon/ai-sdk-provider"));
    ({ experimental_decide: decide } = await import("ai"));
  } catch {
    throw new Error(
      "Jev through Neon needs: npm install @neon/ai-sdk-provider@1.1.0 ai@7.0.133, plus NEON_AI_GATEWAY_TOKEN and NEON_AI_GATEWAY_BASE_URL",
    );
  }
  const { answers } = await decide({
    model: neon.decisionModel(j.model || "typesafeai-jev-1-14-0"),
    state: list[0].facts || {},
    questions: Object.fromEntries(
      list.map((q, i) => [
        `q${i}`,
        {
          type: "boolean",
          instructions: { question: q.question },
          criteria: q.criteria || CRITERIA,
        },
      ]),
    ),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout((j.timeoutSec || 90) * 1000),
  });
  return list.map((_, i) => {
    const a = answers[`q${i}`];
    return a && a.type === "boolean" ? a.probability : null;
  });
}
