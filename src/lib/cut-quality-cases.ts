// The case list and its type live in src/lib so job code (src/trigger/ai-eval) never imports tests/.
// Static JSON imports so the cases are bundled. The synthetic case data lives beside it in cut-quality-data/.
// Add a case: see cut-quality-data/AGENTS.md.

import c_clean_take from "./cut-quality-data/cases/clean-take.json";
import c_deliberate_pause from "./cut-quality-data/cases/deliberate-pause.json";
import c_doubled_words from "./cut-quality-data/cases/doubled-words.json";
import c_meaningful_like from "./cut-quality-data/cases/meaningful-like.json";
import c_placeholder_words from "./cut-quality-data/cases/placeholder-words.json";
import c_plain_fillers from "./cut-quality-data/cases/plain-fillers.json";
import c_restart from "./cut-quality-data/cases/restart.json";
import c_short_take_heavy_cuts from "./cut-quality-data/cases/holdout/short-take-heavy-cuts.json";
import c_stammered_repeat from "./cut-quality-data/cases/stammered-repeat.json";
import c_unclear_word from "./cut-quality-data/cases/unclear-word.json";
import c_toyin3_pattern from "./cut-quality-data/cases/toyin3-pattern.json";
import c_toyin4_nothing_to_say from "./cut-quality-data/cases/toyin4-nothing-to-say.json";
import h_drawn_out_hesitation from "./cut-quality-data/cases/holdout/drawn-out-hesitation.json";
import h_earlier_attempt from "./cut-quality-data/cases/holdout/earlier-attempt.json";
import h_like_and_trailing_filler from "./cut-quality-data/cases/holdout/like-and-trailing-filler.json";
import h_tag_question from "./cut-quality-data/cases/holdout/tag-question.json";
import h_tics_sort_of from "./cut-quality-data/cases/holdout/tics-sort-of.json";
import a_clean_take from "./cut-quality-data/answers/clean-take.json";
import a_deliberate_pause from "./cut-quality-data/answers/deliberate-pause.json";
import a_doubled_words from "./cut-quality-data/answers/doubled-words.json";
import a_meaningful_like from "./cut-quality-data/answers/meaningful-like.json";
import a_placeholder_words from "./cut-quality-data/answers/placeholder-words.json";
import a_plain_fillers from "./cut-quality-data/answers/plain-fillers.json";
import a_restart from "./cut-quality-data/answers/restart.json";
import a_short_take_heavy_cuts from "./cut-quality-data/answers/short-take-heavy-cuts.json";
import a_stammered_repeat from "./cut-quality-data/answers/stammered-repeat.json";
import a_unclear_word from "./cut-quality-data/answers/unclear-word.json";
import a_toyin3_pattern from "./cut-quality-data/answers/toyin3-pattern.json";
import a_toyin4_nothing_to_say from "./cut-quality-data/answers/toyin4-nothing-to-say.json";
import a_drawn_out_hesitation from "./cut-quality-data/answers/drawn-out-hesitation.json";
import a_earlier_attempt from "./cut-quality-data/answers/earlier-attempt.json";
import a_like_and_trailing_filler from "./cut-quality-data/answers/like-and-trailing-filler.json";
import a_tag_question from "./cut-quality-data/answers/tag-question.json";
import a_tics_sort_of from "./cut-quality-data/answers/tics-sort-of.json";
import c_tics_kind_of from "./cut-quality-data/cases/tics-kind-of.json";
import a_tics_kind_of from "./cut-quality-data/answers/tics-kind-of.json";
import c_script_line_twice from "./cut-quality-data/cases/script-line-twice.json";
import a_script_line_twice from "./cut-quality-data/answers/script-line-twice.json";
import c_script_line_three_times from "./cut-quality-data/cases/script-line-three-times.json";
import a_script_line_three_times from "./cut-quality-data/answers/script-line-three-times.json";
import c_script_fluffed_then_clean from "./cut-quality-data/cases/script-fluffed-then-clean.json";
import a_script_fluffed_then_clean from "./cut-quality-data/answers/script-fluffed-then-clean.json";
import c_script_heavy_retakes from "./cut-quality-data/cases/script-heavy-retakes.json";
import a_script_heavy_retakes from "./cut-quality-data/answers/script-heavy-retakes.json";
import h_script_ad_lib from "./cut-quality-data/cases/holdout/script-ad-lib.json";
import a_script_ad_lib from "./cut-quality-data/answers/script-ad-lib.json";
import h_script_skipped_line from "./cut-quality-data/cases/holdout/script-skipped-line.json";
import a_script_skipped_line from "./cut-quality-data/answers/script-skipped-line.json";

export type RecordedAnswer = unknown;
export type CaseEntry = {
  readonly holdout: boolean;
  readonly raw: unknown;
  readonly answer: RecordedAnswer;
};

/** Every case with its recorded model answer. `holdout` cases are scored separately and never tuned on. */
export const CASE_ENTRIES: readonly CaseEntry[] = [
  { holdout: false, raw: c_clean_take, answer: a_clean_take },
  { holdout: false, raw: c_deliberate_pause, answer: a_deliberate_pause },
  { holdout: false, raw: c_doubled_words, answer: a_doubled_words },
  { holdout: false, raw: c_meaningful_like, answer: a_meaningful_like },
  { holdout: false, raw: c_placeholder_words, answer: a_placeholder_words },
  { holdout: false, raw: c_plain_fillers, answer: a_plain_fillers },
  { holdout: false, raw: c_restart, answer: a_restart },
  { holdout: true, raw: c_short_take_heavy_cuts, answer: a_short_take_heavy_cuts },
  { holdout: false, raw: c_stammered_repeat, answer: a_stammered_repeat },
  { holdout: false, raw: c_toyin3_pattern, answer: a_toyin3_pattern },
  { holdout: false, raw: c_unclear_word, answer: a_unclear_word },
  { holdout: false, raw: c_toyin4_nothing_to_say, answer: a_toyin4_nothing_to_say },
  { holdout: false, raw: c_tics_kind_of, answer: a_tics_kind_of },
  { holdout: true, raw: h_drawn_out_hesitation, answer: a_drawn_out_hesitation },
  { holdout: true, raw: h_earlier_attempt, answer: a_earlier_attempt },
  { holdout: true, raw: h_like_and_trailing_filler, answer: a_like_and_trailing_filler },
  { holdout: true, raw: h_tag_question, answer: a_tag_question },
  { holdout: true, raw: h_tics_sort_of, answer: a_tics_sort_of },
  { holdout: false, raw: c_script_line_twice, answer: a_script_line_twice },
  { holdout: false, raw: c_script_line_three_times, answer: a_script_line_three_times },
  { holdout: false, raw: c_script_fluffed_then_clean, answer: a_script_fluffed_then_clean },
  { holdout: false, raw: c_script_heavy_retakes, answer: a_script_heavy_retakes },
  { holdout: true, raw: h_script_ad_lib, answer: a_script_ad_lib },
  { holdout: true, raw: h_script_skipped_line, answer: a_script_skipped_line },
];
