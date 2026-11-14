import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { RecordView } from "@/components/record/record-view";
import { parseUsageEnv } from "@/lib/env";
import { getDb, getSession } from "@/server/request";
import { usageForCreator } from "@/server/usage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Record · Take Studio" };

/**
 * The first usage read (spec 0021 AC-6), so the limit is known before Record starts. Any trouble
 * reads as no limit: the server still refuses a take that does not fit.
 */
async function firstUsage(creatorId: string) {
  try {
    const result = await usageForCreator(await getDb(), {
      creatorId,
      usageSecret: parseUsageEnv().USAGE_HASH_SECRET,
      now: new Date(),
    });
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * `RecordView` with the first usage read. The read starts in the page and is awaited here, so it
 * runs beside `AppShell`'s own read instead of before it (one database round trip less on the
 * way to the first byte). No `Suspense`: the first paint is the same.
 */
async function RecordWithUsage({
  usage,
  creatorId,
}: {
  readonly usage: ReturnType<typeof firstUsage>;
  readonly creatorId: string;
}) {
  return <RecordView usage={await usage} creatorId={creatorId} />;
}

/** Record a take in the browser (spec 0021). Signed out goes to sign in. */
export default async function RecordPage() {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  const usage = firstUsage(session.user.id);
  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="text-h1 font-medium">Record a take</h1>
        <RecordWithUsage usage={usage} creatorId={session.user.id} />
      </div>
    </AppShell>
  );
}
