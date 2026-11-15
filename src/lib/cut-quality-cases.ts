// The case list and its type live in src/lib so job code (src/trigger/ai-eval) never imports tests/.
// Static JSON imports so the cases are bundled. The synthetic case data stays in tests/cut-quality.
// Add a case: see tests/cut-quality/AGENTS.md.

import c_clean_take from "../../tests/cut-quality/cases/clean-take.json";
import c_deliberate_pause from "../../tests/cut-quality/cases/deliberate-pause.json";
import c_doubled_words from "../../tests/cut-quality/cases/doubled-words.json";
import c_meaningful_like from "../../tests/cut-quality/cases/meaningful-like.json";
import c_placeholder_words from "../../tests/cut-quality/cases/placeholder-words.json";
import c_plain_fillers from "../../tests/cut-quality/cases/plain-fillers.json";
import c_restart from "../../tests/cut-quality/cases/restart.json";
import c_short_take_heavy_cuts from "../../tests/cut-quality/cases/holdout/short-take-heavy-cuts.json";
import c_stammered_repeat from "../../tests/cut-quality/cases/stammered-repeat.json";
import c_unclear_word from "../../tests/cut-quality/cases/unclear-word.json";
import c_toyin3_pattern from "../../tests/cut-quality/cases/toyin3-pattern.json";
import c_toyin4_nothing_to_say from "../../tests/cut-quality/cases/toyin4-nothing-to-say.json";
import h_drawn_out_hesitation from "../../tests/cut-quality/cases/holdout/drawn-out-hesitation.json";
import h_earlier_attempt from "../../tests/cut-quality/cases/holdout/earlier-attempt.json";
import h_like_and_trailing_filler from "../../tests/cut-quality/cases/holdout/like-and-trailing-filler.json";
import h_tag_question from "../../tests/cut-quality/cases/holdout/tag-question.json";
import h_tics_sort_of from "../../tests/cut-quality/cases/holdout/tics-sort-of.json";
import a_clean_take from "../../tests/cut-quality/answers/clean-take.json";
import a_deliberate_pause from "../../tests/cut-quality/answers/deliberate-pause.json";
import a_doubled_words from "../../tests/cut-quality/answers/doubled-words.json";
import a_meaningful_like from "../../tests/cut-quality/answers/meaningful-like.json";
import a_placeholder_words from "../../tests/cut-quality/answers/placeholder-words.json";
import a_plain_fillers from "../../tests/cut-quality/answers/plain-fillers.json";
import a_restart from "../../tests/cut-quality/answers/restart.json";
import a_short_take_heavy_cuts from "../../tests/cut-quality/answers/short-take-heavy-cuts.json";
import a_stammered_repeat from "../../tests/cut-quality/answers/stammered-repeat.json";
import a_unclear_word from "../../tests/cut-quality/answers/unclear-word.json";
import a_toyin3_pattern from "../../tests/cut-quality/answers/toyin3-pattern.json";
import a_toyin4_nothing_to_say from "../../tests/cut-quality/answers/toyin4-nothing-to-say.json";
import a_drawn_out_hesitation from "../../tests/cut-quality/answers/drawn-out-hesitation.json";
import a_earlier_attempt from "../../tests/cut-quality/answers/earlier-attempt.json";
import a_like_and_trailing_filler from "../../tests/cut-quality/answers/like-and-trailing-filler.json";
import a_tag_question from "../../tests/cut-quality/answers/tag-question.json";
import a_tics_sort_of from "../../tests/cut-quality/answers/tics-sort-of.json";
import c_tics_kind_of from "../../tests/cut-quality/cases/tics-kind-of.json";
import a_tics_kind_of from "../../tests/cut-quality/answers/tics-kind-of.json";
import c_script_line_twice from "../../tests/cut-quality/cases/script-line-twice.json";
import a_script_line_twice from "../../tests/cut-quality/answers/script-line-twice.json";
import c_script_line_three_times from "../../tests/cut-quality/cases/script-line-three-times.json";
import a_script_line_three_times from "../../tests/cut-quality/answers/script-line-three-times.json";
import c_script_fluffed_then_clean from "../../tests/cut-quality/cases/script-fluffed-then-clean.json";
import a_script_fluffed_then_clean from "../../tests/cut-quality/answers/script-fluffed-then-clean.json";
import c_script_heavy_retakes from "../../tests/cut-quality/cases/script-heavy-retakes.json";
import a_script_heavy_retakes from "../../tests/cut-quality/answers/script-heavy-retakes.json";
import h_script_ad_lib from "../../tests/cut-quality/cases/holdout/script-ad-lib.json";
import a_script_ad_lib from "../../tests/cut-quality/answers/script-ad-lib.json";
import h_script_skipped_line from "../../tests/cut-quality/cases/holdout/script-skipped-line.json";
import a_script_skipped_line from "../../tests/cut-quality/answers/script-skipped-line.json";

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
