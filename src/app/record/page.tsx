import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { RecordView } from "@/components/record/record-view";
import { getSession } from "@/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Record · Take Studio" };

/** Record a take in the browser (spec 0021). Signed out goes to sign in. */
export default async function RecordPage() {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="text-h1 font-medium">Record a take</h1>
        <RecordView />
      </div>
    </AppShell>
  );
}
