import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { TakeView } from "@/components/takes/take-view";
import { tabTitle } from "@/lib/take-display";
import { getTakeEmails } from "@/db/data/email-prefs";
import { getDb, getSession } from "@/server/request";
import { getForCreator } from "@/server/takes";
import { awaitRead, startRead, type SettledRead } from "@/lib/settled-read";

export const dynamic = "force-dynamic";

type Props = { readonly params: Promise<{ readonly id: string }> };

/** The signed in creator's take, or null for a missing, foreign or malformed ID (AC-11). */
const loadTake = cache(async (takeId: string) => {
  const session = await getSession(await headers());
  if (!session) return { session: null, take: null };
  const found = await getForCreator(await getDb(), session.user.id, takeId);
  return { session, take: found.ok ? found.data.take : null };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { take } = await loadTake((await params).id);
  return { title: take ? tabTitle(take.status, take.title) : "Not found · Take Studio" };
}

/**
 * `TakeView` with the creator's email setting. The read starts in the page and is awaited here,
 * so it runs beside `AppShell`'s own read instead of before it. No `Suspense`: same first paint.
 */
async function TakeViewWithEmails({
  takeId,
  title,
  status,
  takeEmails,
}: {
  readonly takeId: string;
  readonly title: string;
  readonly status: Parameters<typeof TakeView>[0]["initialStatus"];
  readonly takeEmails: Promise<SettledRead<boolean>>;
}) {
  return (
    <TakeView
      takeId={takeId}
      initialTitle={title}
      initialStatus={status}
      takeEmails={await awaitRead(takeEmails)}
    />
  );
}

/**
 * The take page (spec 0004, AC-8 to AC-11): ownership is checked here, so another creator's
 * take and a malformed ID get the same styled 404. The live part (polling, player, actions)
 * is the client `TakeView`, which reads GET /api/takes/{id}.
 */
export default async function TakePage({ params }: Props) {
  const { session, take } = await loadTake((await params).id);
  if (!session) redirect("/");
  if (!take) notFound();
  const takeEmails = startRead(
    getDb()
      .then((db) => getTakeEmails(db, session.user.id))
      .then((value) => value ?? true),
  );

  return (
    <AppShell
      user={{ id: session.user.id, name: session.user.name, email: session.user.email }}
      current={{ title: take.title, status: take.status }}
    >
      <TakeViewWithEmails
        takeId={take.id}
        title={take.title}
        status={take.status}
        takeEmails={takeEmails}
      />
    </AppShell>
  );
}
