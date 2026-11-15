import baseline from "@/lib/cut-quality-data/baseline.json";
import { casesByTrouble, checkFloors } from "@/lib/ai-eval-record";
import type { CutTestRun } from "@/server/analytics/report";

const score = (n: number) => n.toFixed(3);
const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * The cut test section (B2-T72): the latest `ai-eval` run against the baseline floors, the
 * cases with misses or wrong keeps first, and the last five runs. Scores, case ids and cut
 * kinds with times only: the cases are invented, there are no words and no videos.
 */
export function CutTestSection({ runs }: { readonly runs: readonly CutTestRun[] }) {
  const latest = runs[0];
  return (
    <section aria-labelledby="cut-test" className="flex flex-col gap-3">
      <h2 id="cut-test" className="text-h3">
        Cut test
      </h2>
      {!latest ? (
        <p className="text-sm text-muted-foreground">
          No run yet. Start ai-eval from the Trigger.dev dashboard and its result shows here.
        </p>
      ) : (
        <Latest run={latest} />
      )}
      {runs.length > 0 ? <History runs={runs} /> : null}
    </section>
  );
}

function Latest({ run }: { readonly run: CutTestRun }) {
  const floors = checkFloors(run, baseline);
  const cases = casesByTrouble(run.summary);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Run {when(run.ranAt)} with {run.model}: {run.cases} cases, {run.wrongKeeps} wrong keeps.
        Invented test takes only: no words, no videos.
      </p>
      <div className="overflow-x-auto" role="region" aria-label="Cut test totals" tabIndex={0}>
        <table className="w-full max-w-2xl text-left">
          <caption className="sr-only">Latest cut test scores against the baseline floors</caption>
          <thead>
            <tr className="border-b border-border text-sm">
              <th scope="col" className="py-2 pr-4 font-medium">
                Group
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Precision (floor)
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Recall (floor)
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Against floors
              </th>
            </tr>
          </thead>
          <tbody>
            {floors.map((f) => (
              <tr key={f.group} className="border-b border-border">
                <th scope="row" className="py-3 pr-4 font-normal">
                  {f.group === "all" ? "Overall" : "Held out"}
                </th>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {score(f.precision)} ({score(f.precisionFloor)})
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {score(f.recall)} ({score(f.recallFloor)})
                </td>
                <td className="py-3 text-right">{f.ok ? "At or above" : "Below a floor"}</td>
              </tr>
            ))}
            <tr className="border-b border-border">
              <th scope="row" className="py-3 pr-4 font-normal">
                Main set
              </th>
              <td className="py-3 pr-4 text-right tabular-nums">{score(run.mainPrecision)}</td>
              <td className="py-3 pr-4 text-right tabular-nums">{score(run.mainRecall)}</td>
              <td className="py-3 text-right text-muted-foreground">no floor</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto" role="region" aria-label="Cut test cases" tabIndex={0}>
        <table className="w-full text-left">
          <caption className="sr-only">Cases of the latest run, those with trouble first</caption>
          <thead>
            <tr className="border-b border-border text-sm">
              <th scope="col" className="py-2 pr-4 font-medium">
                Case
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Precision
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Recall
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Cuts
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Missed
              </th>
              <th scope="col" className="py-2 font-medium">
                Wrong keeps
              </th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-b border-border align-top">
                <th scope="row" className="py-3 pr-4 font-normal">
                  {c.id}
                  {c.holdout ? " (held out)" : ""}
                  {c.fallback ? ` (fell back: ${c.fallback})` : ""}
                </th>
                <td className="py-3 pr-4 text-right tabular-nums">{score(c.precision)}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{score(c.recall)}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{c.cuts}</td>
                <td className="mono py-3 pr-4 text-small">{c.missed.join(", ") || "none"}</td>
                <td className="mono py-3 text-small">{c.wrongKeeps.join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function History({ runs }: { readonly runs: readonly CutTestRun[] }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label="Recent cut test runs" tabIndex={0}>
      <table className="w-full max-w-2xl text-left">
        <caption className="sr-only">Overall scores of the last five runs, newest first</caption>
        <thead>
          <tr className="border-b border-border text-sm">
            <th scope="col" className="py-2 pr-4 font-medium">
              Run
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Precision
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Recall
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.ranAt.toISOString()} className="border-b border-border">
              <th scope="row" className="py-3 pr-4 font-normal">
                {when(r.ranAt)}
              </th>
              <td className="py-3 pr-4 text-right tabular-nums">{score(r.overallPrecision)}</td>
              <td className="py-3 text-right tabular-nums">{score(r.overallRecall)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
