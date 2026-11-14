import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { FunnelTable, WindowLinks } from "@/components/insights/funnel-table";
import { insightsWindowSchema } from "@/lib/analytics-events";
import { isInsightsViewer } from "@/lib/env";
import { funnel } from "@/server/analytics/report";
import { getDb, getSession } from "@/server/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Insights · Take Studio",
  robots: { index: false, follow: false },
};

/**
 * Private product numbers (spec 0016, AC-7, AC-8): only the configured viewer sees it; anyone
 * else, signed in or not, gets the same 404 as a missing page. Counts only.
 */
export default async function InsightsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession(await headers());
  if (!isInsightsViewer(session?.user.id)) notFound();
  const window = insightsWindowSchema.parse((await searchParams).window);
  const counts = await funnel(await getDb(), window);

  return (
    <AppShell user={{ id: session!.user.id, name: session!.user.name, email: session!.user.email }}>
      <div className="flex flex-col gap-6">
        <h1 className="text-h2">Insights</h1>
        <WindowLinks current={window} />
        <FunnelTable funnel={counts} />
        <p className="text-sm text-muted-foreground">
          Counts come from recorded events and can miss a few.
        </p>
      </div>
    </AppShell>
  );
}
