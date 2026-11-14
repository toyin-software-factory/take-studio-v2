import { Progress } from "@/components/ui/progress";
import { shortDate, usageDisplay, usageNotice, type UsageSummary } from "@/lib/usage-rules";

/** The four numbers of `GET /api/usage` plus whether the limit is switched on (spec 0014). */
export type UsageView = UsageSummary & { readonly enforced: boolean };

const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/** The polite "running low" line (AC-9): empty until 80 % of the allowance is used. */
export function lowNotice(usage: UsageSummary): string {
  const { leftMinutes } = usageDisplay(usage.allowanceSeconds, usage.usedSeconds);
  return usageNotice(usage.allowanceSeconds, usage.usedSeconds) === "low"
    ? `You have ${minutes(leftMinutes)} left this month.`
    : "";
}

/** Shown in the drop zone when nothing is left (AC-9). */
export function usedUpMessage(usage: UsageSummary): string {
  const { allowanceMinutes } = usageDisplay(usage.allowanceSeconds, usage.usedSeconds);
  return `You've used this month's ${allowanceMinutes} minutes. They come back on ${shortDate(usage.resetsOn)}.`;
}

/**
 * The monthly minutes meter (spec 0014 AC-9; design.md Usage meter): a thin progress bar with
 * "12 of 60 minutes used this month · resets 1 Dec" under it. The bar has a name and a spoken
 * value, the status line is always in the page so the low notice is announced when it appears.
 */
export function UsageMeter({ usage }: { readonly usage: UsageSummary }) {
  const { usedMinutes, allowanceMinutes } = usageDisplay(usage.allowanceSeconds, usage.usedSeconds);
  const percent =
    usage.allowanceSeconds > 0
      ? Math.min(100, Math.round((usage.usedSeconds / usage.allowanceSeconds) * 100))
      : 100;
  const summary = `${usedMinutes} of ${allowanceMinutes} minutes used this month`;
  return (
    <div data-testid="usage-meter" className="flex flex-col gap-2">
      <Progress value={percent} aria-label="Minutes used this month" aria-valuetext={summary} />
      <p className="text-small text-muted-foreground">
        {summary} <span aria-hidden="true">·</span> resets {shortDate(usage.resetsOn)}
      </p>
      <p role="status" className="text-small font-medium empty:sr-only">
        {lowNotice(usage)}
      </p>
    </div>
  );
}
