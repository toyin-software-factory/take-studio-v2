import { CUT_QUALITY_MIN_TAKES, type CutQuality, cutRate } from "@/lib/cut-quality";

const PROPOSER_LABELS = { rules: "Rules", ai: "AI", creator: "Creator" } as const;
const KIND_LABELS = {
  pause: "Pause",
  false_start: "False start",
  filler: "Filler",
  manual: "Manual",
} as const;

const percent = (value: number | null) => (value === null ? "too few takes" : `${value}%`);

/**
 * The cut quality section (spec 0017 AC-5): one row per proposer and kind, counts and rates
 * only, never a creator or a take. A row with fewer than five reviewed takes shows no rate.
 */
export function CutQualityTable({ quality }: { readonly quality: CutQuality }) {
  const perTake = (n: number) =>
    quality.reviewedTakes < CUT_QUALITY_MIN_TAKES
      ? "too few takes"
      : (n / quality.reviewedTakes).toFixed(2);
  return (
    <section aria-labelledby="cut-quality" className="flex flex-col gap-3">
      <h2 id="cut-quality" className="text-h3">
        Cut quality
      </h2>
      <p className="text-sm text-muted-foreground">
        From the latest download of each take. Counts only: no words, no videos.{" "}
        {quality.reviewedTakes} reviewed takes, {quality.missed} missed marks (
        {perTake(quality.missed)} per take).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl text-left">
          <caption className="sr-only">Cut quality by who proposed the cut and its kind</caption>
          <thead>
            <tr className="border-b border-border text-sm">
              <th scope="col" className="py-2 pr-4 font-medium">
                Cuts
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Takes
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Proposed
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Undone
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Restored
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Added per take
              </th>
            </tr>
          </thead>
          <tbody>
            {quality.rows.map(({ proposer, kind, takes, tally }) => (
              <tr key={`${proposer}-${kind}`} className="border-b border-border">
                <th scope="row" className="py-3 pr-4 font-normal">
                  {PROPOSER_LABELS[proposer]} {KIND_LABELS[kind].toLowerCase()}
                </th>
                <td className="py-3 pr-4 text-right tabular-nums">{takes}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{tally.proposed}</td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {percent(cutRate(tally.undone, tally.proposed, takes))}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {kind === "pause" && proposer !== "creator"
                    ? percent(cutRate(tally.restored, tally.kept, takes))
                    : "n/a"}
                </td>
                <td className="py-3 text-right tabular-nums">
                  {tally.added === 0 ? "0" : (tally.added / takes).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {quality.rows.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">No downloads reviewed yet.</p>
        )}
      </div>
    </section>
  );
}
