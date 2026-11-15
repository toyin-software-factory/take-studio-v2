import { describe, expect, it } from "vitest";
import { ORACLE } from "./client-schema-oracle";
import { createdKeySchema, failureSchema } from "./api-keys-screen";
import { backgroundItemSchema, backgroundListSchema } from "./background-api";
import { previewViewSchema } from "./background-preview-api";
import { connectedAppSchema, connectedAppsSchema, consentAnswerSchema } from "./oauth-screen";
import { settingsSchema } from "./prompter-storage";
import { resultsSchema, stepSchema, tokenSchema } from "./realtime-stream";
import { siteOrigin } from "./site";
import {
  apiErrorSchema,
  mediaLinkSchema,
  takeCardSchema,
  takeDetailSchema,
  takeListSchema,
  takeSchema,
  transcriptEditSchema,
  transcriptViewSchema,
} from "./take-api";
import { createdBody, errorBody, linksBody, sizeMismatch } from "./upload-client";
import { prefsSchema } from "@/components/takes/email-switch";
import { renamedSchema } from "@/components/takes/rename-form";
import { errorSchema, jobSchema, jobStarted } from "@/components/takes/use-change-render";
import { usageBody } from "@/components/takes/use-usage";
import { waveformSchema } from "@/components/takes/use-waveform";

/**
 * B2-T108: the browser's response schemas moved from full zod to `zod/mini`. Each pair below is
 * the new schema and the old one (`client-schema-oracle.ts`). Every fixture, and every
 * variation made from it (a field dropped, nulled, given the wrong type or an odd number, an
 * extra key added), must pass or fail the same way and parse to the same data.
 */

type Parser = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };

const card = {
  id: "t1",
  title: "My take",
  status: "ready",
  durationMs: 12000,
  videoExpiresAt: "2026-12-01T00:00:00.000Z",
  createdAt: "2026-11-01T00:00:00.000Z",
  failureCode: null,
  retryable: false,
  expired: false,
};
const takeFull = { ...card, container: "mp4", script: "Hello there" };
const word = { index: 0, w: "hi", startMs: 0, endMs: 200, filler: false };
const edit = { index: 0, old: "teh", new: "the", reason: "typo", undone: false };
const bgItem = {
  id: "b1",
  name: "Studio",
  alt: "A studio",
  status: "ready",
  failureCode: null,
  thumbUrl: "https://example.test/t.png",
};
const app = { id: "a1", name: "Assistant", connectedAt: "2026-11-01", lastUsedAt: null };
const detail = {
  take: takeFull,
  latestJob: {
    id: "j1",
    kind: "initial",
    status: "succeeded",
    failureCode: null,
    steps: [{ name: "trim", status: "succeeded", progress: 1 }],
  },
  latestRender: {
    id: "r1",
    status: "succeeded",
    durationMs: 9000,
    removedRanges: [{ startMs: 100, endMs: 400 }],
  },
  cuts: [
    {
      id: "c1",
      startMs: 100,
      endMs: 400,
      kind: "silence",
      applied: true,
      proposedBy: "ai",
      reason: "pause",
    },
  ],
  aiEdit: "done",
  suggestion: { backgroundId: "b1", name: "Studio", reason: "fits" },
  originalAvailable: true,
  removedMs: 300,
  note: null,
  background: { id: "b1", name: "Studio", keyed: true },
  noGreenScreen: false,
  backgroundJob: { status: "succeeded", failureCode: null, targetBackgroundId: "b1" },
};
/** Older bodies: every field with a default left out. */
const detailOld = {
  take: { ...card, container: "mp4" },
  latestJob: null,
  latestRender: { id: "r1", status: "succeeded", durationMs: null },
  removedMs: 0,
  note: "no_cuts",
  cuts: [{ id: "c1", startMs: 0, endMs: 1, kind: "silence", applied: false }],
  backgroundJob: { status: "failed", failureCode: "x" },
};

type Case = { name: string; next: Parser; old: Parser; fixtures: unknown[] };
const cases: Case[] = [
  { name: "takeCard", next: takeCardSchema, old: ORACLE.takeCard, fixtures: [card] },
  {
    name: "takeList",
    next: takeListSchema,
    old: ORACLE.takeList,
    fixtures: [
      { takes: [card], nextCursor: null },
      { takes: [], nextCursor: "abc" },
    ],
  },
  {
    name: "take",
    next: takeSchema,
    old: ORACLE.take,
    fixtures: [takeFull, { ...takeFull, script: null }, { ...card, container: "webm" }],
  },
  {
    name: "takeDetail",
    next: takeDetailSchema,
    old: ORACLE.takeDetail,
    fixtures: [detail, detailOld],
  },
  {
    name: "mediaLink",
    next: mediaLinkSchema,
    old: ORACLE.mediaLink,
    fixtures: [{ url: "https://example.test/v.mp4?x=1" }, { url: "/relative" }, { url: "" }],
  },
  {
    name: "apiError",
    next: apiErrorSchema,
    old: ORACLE.apiError,
    fixtures: [{ error: "e", message: "m" }],
  },
  {
    name: "transcriptEdit",
    next: transcriptEditSchema,
    old: ORACLE.transcriptEdit,
    fixtures: [edit],
  },
  {
    name: "transcriptView",
    next: transcriptViewSchema,
    old: ORACLE.transcriptView,
    fixtures: [
      {
        state: "ready",
        canMake: false,
        version: "v1",
        paragraphs: [{ startMs: 0, words: [word] }],
        edits: [edit],
      },
      { state: "skipped", reason: "not_english", canMake: true },
    ],
  },
  {
    name: "backgroundItem",
    next: backgroundItemSchema,
    old: ORACLE.backgroundItem,
    fixtures: [bgItem, { ...bgItem, failureCode: undefined }],
  },
  {
    name: "backgroundList",
    next: backgroundListSchema,
    old: ORACLE.backgroundList,
    fixtures: [{ builtIn: [bgItem], mine: [], defaultId: null }],
  },
  {
    name: "previewView",
    next: previewViewSchema,
    old: ORACLE.previewView,
    fixtures: [
      { state: "ready", url: "https://example.test/p.jpg", noGreenScreen: true },
      { state: "making" },
    ],
  },
  {
    name: "consentAnswer",
    next: consentAnswerSchema,
    old: ORACLE.consentAnswer,
    fixtures: [{ url: "https://x.test/cb" }, { url: "" }],
  },
  {
    name: "connectedApp",
    next: connectedAppSchema,
    old: ORACLE.connectedApp,
    fixtures: [app, { ...app, name: null }],
  },
  {
    name: "connectedApps",
    next: connectedAppsSchema,
    old: ORACLE.connectedApps,
    fixtures: [{ apps: [app] }, { apps: [] }],
  },
  {
    name: "createdKey",
    next: createdKeySchema,
    old: ORACLE.createdKey,
    fixtures: [
      { id: "k1", name: "n", prefix: "abcd1234", key: "tsk_x", createdAt: "2026-11-01" },
      { id: "k1", name: "n", prefix: "p", key: "", createdAt: "d" },
    ],
  },
  {
    name: "keyFailure",
    next: failureSchema,
    old: ORACLE.keyFailure,
    fixtures: [{ error: "e", message: "m" }],
  },
  {
    name: "prompterSettings",
    next: settingsSchema,
    old: ORACLE.prompterSettings,
    fixtures: [
      { wpm: 140, size: 44 },
      { wpm: 140, size: 44, follow: true, followDisclosed: false },
    ],
  },
  {
    name: "realtimeResults",
    next: resultsSchema,
    old: ORACLE.realtimeResults,
    fixtures: [
      { type: "Results", channel: { alternatives: [{ transcript: "hello" }] } },
      { type: "Results", channel: { alternatives: [] } },
      { type: "Metadata", channel: { alternatives: [{ transcript: "x" }] } },
    ],
  },
  {
    name: "realtimeToken",
    next: tokenSchema,
    old: ORACLE.realtimeToken,
    fixtures: [
      { token: "t", expiresInSeconds: 60 },
      { token: "", expiresInSeconds: 60 },
      { token: "t", expiresInSeconds: 0 },
    ],
  },
  {
    name: "realtimeStep",
    next: stepSchema,
    old: ORACLE.realtimeStep,
    fixtures: [{ step: "usage" }, { step: "other" }],
  },
  { name: "uploadError", next: errorBody, old: ORACLE.uploadError, fixtures: [{ message: "m" }] },
  {
    name: "uploadCreated",
    next: createdBody,
    old: ORACLE.uploadCreated,
    fixtures: [
      { takeId: "t", partSize: 5242880, partCount: 3 },
      { takeId: "t", partSize: 1.5, partCount: 0 },
    ],
  },
  {
    name: "uploadSizeMismatch",
    next: sizeMismatch,
    old: ORACLE.uploadSizeMismatch,
    fixtures: [{ error: "size_mismatch" }, { error: "other" }],
  },
  {
    name: "uploadLinks",
    next: linksBody,
    old: ORACLE.uploadLinks,
    fixtures: [
      { parts: [{ partNumber: 1, url: "https://r2.test/p1" }], expiresInSeconds: 900 },
      { parts: [{ partNumber: 1.5, url: "u" }], expiresInSeconds: -1 },
    ],
  },
  {
    name: "emailPrefs",
    next: prefsSchema,
    old: ORACLE.emailPrefs,
    fixtures: [{ takeEmails: true }],
  },
  { name: "renamed", next: renamedSchema, old: ORACLE.renamed, fixtures: [{ take: takeFull }] },
  {
    name: "changeError",
    next: errorSchema,
    old: ORACLE.changeError,
    fixtures: [{ error: "e" }, { error: "e", message: "m" }],
  },
  { name: "changeJob", next: jobSchema, old: ORACLE.changeJob, fixtures: [{ status: "running" }] },
  {
    name: "changeStarted",
    next: jobStarted,
    old: ORACLE.changeStarted,
    fixtures: [{ jobId: "j" }],
  },
  {
    name: "usageBody",
    next: usageBody,
    old: ORACLE.usageBody,
    fixtures: [
      { usedSeconds: 10, allowanceSeconds: 3600, remainingSeconds: 3590, resetsOn: "2026-12-01" },
    ],
  },
  {
    name: "waveform",
    next: waveformSchema,
    old: ORACLE.waveform,
    fixtures: [{ waveform: [0, 50, 100] }, { waveform: null }],
  },
];

const WRONG: readonly unknown[] = [
  null,
  undefined,
  "",
  "x",
  0,
  -1,
  1.5,
  1e21,
  true,
  false,
  [],
  {},
  [1],
  { a: 1 },
  "https://a.test",
];

/** Every way to damage `value` one step at a time: replace, drop or add at each place in it. */
function variations(value: unknown): unknown[] {
  const out: unknown[] = [];
  const visit = (node: unknown, rebuild: (next: unknown) => unknown): void => {
    for (const bad of WRONG) out.push(rebuild(bad));
    if (Array.isArray(node)) {
      out.push(rebuild([]));
      out.push(rebuild([...node, ...node]));
      node.forEach((item, i) =>
        visit(item, (next) => rebuild(node.map((x, j) => (j === i ? next : x)))),
      );
    } else if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      out.push(rebuild({ ...obj, extra: 1 }));
      for (const key of Object.keys(obj)) {
        const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
        out.push(rebuild(rest));
        visit(obj[key], (next) => rebuild({ ...obj, [key]: next }));
      }
    }
  };
  visit(value, (next) => next);
  return out;
}

function sameAnswer(next: Parser, old: Parser, input: unknown): string | null {
  const a = next.safeParse(input);
  const b = old.safeParse(input);
  if (a.success !== b.success) {
    return `new ${a.success ? "accepts" : "refuses"}, old ${b.success ? "accepts" : "refuses"}`;
  }
  if (a.success && JSON.stringify(a.data) !== JSON.stringify(b.data)) {
    return "parsed data differs";
  }
  return null;
}

describe("client schemas: zod/mini against the old full zod shapes (B2-T108)", () => {
  for (const c of cases) {
    it(`${c.name}: fixtures and variations give the same answers`, () => {
      const differences: string[] = [];
      let accepted = 0;
      for (const fixture of c.fixtures) {
        for (const input of [fixture, ...variations(fixture)]) {
          const why = sameAnswer(c.next, c.old, input);
          if (why) differences.push(`${why}: ${JSON.stringify(input)}`);
          if (c.old.safeParse(input).success) accepted += 1;
        }
      }
      expect(differences.slice(0, 5)).toEqual([]);
      expect(accepted).toBeGreaterThan(0);
    });
  }

  it("takeDetail fills the same defaults as before", () => {
    const parsed = takeDetailSchema.safeParse(detailOld);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.originalAvailable).toBe(true);
    expect(parsed.data.aiEdit).toBeNull();
    expect(parsed.data.noGreenScreen).toBe(false);
    expect(parsed.data.cuts[0]?.proposedBy).toBe("rules");
    expect(parsed.data.latestRender?.removedRanges).toEqual([]);
  });

  it("siteOrigin accepts and refuses what the full zod url check did", () => {
    const inputs = [
      undefined,
      "",
      "x",
      "https://take.studio",
      "http://localhost:3000/a?b=1",
      "ftp://h/p",
      "//h",
      "https://",
      "mailto:a@b.c",
      "javascript:alert(1)",
      "HTTPS://A.TEST",
      " https://a.test",
      "https://a b.test",
    ];
    for (const input of inputs) {
      const old = ORACLE.siteUrl.safeParse(input);
      expect(siteOrigin(input), String(input)).toBe(old.success ? new URL(old.data).origin : null);
    }
  });
});
