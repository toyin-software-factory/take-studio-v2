import { clock } from "./script-stats";

const TIPS = [
  {
    title: "Look at the green line",
    body: "It sits just under the camera, so your eyes stay near the lens.",
  },
  { title: "Pause when you like", body: "Gaps are cut for you. Take a breath, then carry on." },
  { title: "Plain wall or green screen", body: "Either works. You pick a studio after." },
] as const;

/**
 * The right column (draft "Before you start"): the minutes left this month, from the creator's
 * real usage (nothing is shown when the limit is off or unread), then three tips.
 */
export function SetupAside({
  leftMinutes,
  maxTakeSeconds,
}: {
  /** Whole minutes left this month; null when the limit is off or could not be read. */
  readonly leftMinutes: number | null;
  readonly maxTakeSeconds: number;
}) {
  return (
    <aside className="rec-side" aria-label="Before you start">
      {leftMinutes === null ? null : (
        <div className="rec-stat rec-enter" style={{ ["--i" as string]: 0 }}>
          <p className="rec-stat__num">
            <span className="rec-flip" aria-hidden="true">
              {leftMinutes}
            </span>
            <span className="sr-only">{leftMinutes}</span>
            <small>min left</small>
          </p>
          <p className="rec-stat__label">
            This month. One take can run up to {clock(maxTakeSeconds)}.
          </p>
        </div>
      )}
      <ol
        className="rec-tips rec-enter"
        style={{ ["--i" as string]: 1 }}
        data-check="s1-setup-list"
      >
        {TIPS.map((tip, i) => (
          <li key={tip.title} data-check={i === 0 ? "s1-setup-item" : undefined}>
            <span>{String(i + 1).padStart(2, "0")}.</span>
            <div>
              <b>{tip.title}</b>
              <p>{tip.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
