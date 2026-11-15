import { type ExpectedSpan } from "./cut-quality";

export const span = (
  startMs: number,
  endMs: number,
  verdict: ExpectedSpan["verdict"] = "cut",
  kind: ExpectedSpan["kind"] = "filler",
): ExpectedSpan => ({ startMs, endMs, kind, verdict });
