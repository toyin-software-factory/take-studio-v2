import {} from "./client-schema-oracle";
import {} from "./background-preview-api";
import {} from "./prompter-storage";
import {} from "./site";
import {} from "@/components/takes/email-switch";
import {} from "@/components/takes/rename-form";
import {} from "@/components/takes/use-usage";
import {} from "@/components/takes/use-waveform";

export const card = {
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
export const takeFull = { ...card, container: "mp4", script: "Hello there" };
export const word = { index: 0, w: "hi", startMs: 0, endMs: 200, filler: false };
export const edit = { index: 0, old: "teh", new: "the", reason: "typo", undone: false };
export const bgItem = {
  id: "b1",
  name: "Studio",
  alt: "A studio",
  status: "ready",
  failureCode: null,
  thumbUrl: "https://example.test/t.png",
};
export const app = { id: "a1", name: "Assistant", connectedAt: "2026-11-01", lastUsedAt: null };
export const detail = {
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
export const detailOld = {
  take: { ...card, container: "mp4" },
  latestJob: null,
  latestRender: { id: "r1", status: "succeeded", durationMs: null },
  removedMs: 0,
  note: "no_cuts",
  cuts: [{ id: "c1", startMs: 0, endMs: 1, kind: "silence", applied: false }],
  backgroundJob: { status: "failed", failureCode: "x" },
};
