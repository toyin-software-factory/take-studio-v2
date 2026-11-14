// Static JSON imports so the cases are bundled (job code may import tests/). Add a case: see AGENTS.md.

import c_clean_take from "./clean-take.json";
import c_deliberate_pause from "./deliberate-pause.json";
import c_doubled_words from "./doubled-words.json";
import c_meaningful_like from "./meaningful-like.json";
import c_placeholder_words from "./placeholder-words.json";
import c_plain_fillers from "./plain-fillers.json";
import c_restart from "./restart.json";
import c_stammered_repeat from "./stammered-repeat.json";
import c_toyin3_pattern from "./toyin3-pattern.json";
import c_toyin4_nothing_to_say from "./toyin4-nothing-to-say.json";
import h_drawn_out_hesitation from "./holdout/drawn-out-hesitation.json";
import h_earlier_attempt from "./holdout/earlier-attempt.json";
import h_like_and_trailing_filler from "./holdout/like-and-trailing-filler.json";
import h_tag_question from "./holdout/tag-question.json";
import h_tics_sort_of from "./holdout/tics-sort-of.json";
import a_clean_take from "../answers/clean-take.json";
import a_deliberate_pause from "../answers/deliberate-pause.json";
import a_doubled_words from "../answers/doubled-words.json";
import a_meaningful_like from "../answers/meaningful-like.json";
import a_placeholder_words from "../answers/placeholder-words.json";
import a_plain_fillers from "../answers/plain-fillers.json";
import a_restart from "../answers/restart.json";
import a_stammered_repeat from "../answers/stammered-repeat.json";
import a_toyin3_pattern from "../answers/toyin3-pattern.json";
import a_toyin4_nothing_to_say from "../answers/toyin4-nothing-to-say.json";
import a_drawn_out_hesitation from "../answers/drawn-out-hesitation.json";
import a_earlier_attempt from "../answers/earlier-attempt.json";
import a_like_and_trailing_filler from "../answers/like-and-trailing-filler.json";
import a_tag_question from "../answers/tag-question.json";
import a_tics_sort_of from "../answers/tics-sort-of.json";

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
  { holdout: false, raw: c_stammered_repeat, answer: a_stammered_repeat },
  { holdout: false, raw: c_toyin3_pattern, answer: a_toyin3_pattern },
  { holdout: false, raw: c_toyin4_nothing_to_say, answer: a_toyin4_nothing_to_say },
  { holdout: true, raw: h_drawn_out_hesitation, answer: a_drawn_out_hesitation },
  { holdout: true, raw: h_earlier_attempt, answer: a_earlier_attempt },
  { holdout: true, raw: h_like_and_trailing_filler, answer: a_like_and_trailing_filler },
  { holdout: true, raw: h_tag_question, answer: a_tag_question },
  { holdout: true, raw: h_tics_sort_of, answer: a_tics_sort_of },
];
