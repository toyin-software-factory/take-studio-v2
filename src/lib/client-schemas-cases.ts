import { ORACLE } from "./client-schema-oracle";
import { createdKeySchema, failureSchema } from "./api-keys-screen";
import { backgroundItemSchema, backgroundListSchema } from "./background-api";
import { previewViewSchema } from "./background-preview-api";
import { connectedAppSchema, connectedAppsSchema, consentAnswerSchema } from "./oauth-screen";
import { settingsSchema } from "./prompter-storage";
import { resultsSchema, stepSchema, tokenSchema } from "./realtime-stream";
import {} from "./site";
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
import {
  app,
  bgItem,
  card,
  detail,
  detailOld,
  edit,
  takeFull,
  word,
} from "./client-schemas-fixtures";
import { type Parser } from "./client-schemas-helpers";

type Case = { name: string; next: Parser; old: Parser; fixtures: unknown[] };
export const cases: Case[] = [
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
