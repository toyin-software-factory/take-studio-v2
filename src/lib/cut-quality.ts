/**
 * Cut quality measurement (spec 0017, AC-7 and AC-8). Pure: the written test case schema and
 * `scoreCuts`. A case is an invented transcript in the shape the AI edit reads (words, times,
 * filler flags, pause candidates) with the right cuts marked. No real creator words anywhere.
 *
 * Split by job (B2-T116): `cut-quality-case` (the case schema), `cut-quality-score` (scoring)
 * and `cut-quality-counts` (field counts at download and misses). This file only re-exports.
 */
export { cutCaseSchema, type CutCase, type ExpectedSpan, type ScoredCut } from "./cut-quality-case";
export {
  HIT_SHARE,
  combineScores,
  scoreCuts,
  type CutScore,
  type Ratios,
  type Tally,
} from "./cut-quality-score";
export {
  CUT_QUALITY_MIN_TAKES,
  MISSED_MARK,
  countCuts,
  cutRate,
  missesOf,
  summariseCutQuality,
  type CutCounts,
  type CutQuality,
  type CutQualityRow,
  type CutRow,
  type CutTally,
  type SpanRef,
} from "./cut-quality-counts";
