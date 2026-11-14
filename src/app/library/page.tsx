import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DELETED_PARAM } from "@/lib/take-delete";
import { AppShell } from "@/components/shell/app-shell";
import { LibraryHeading } from "@/components/takes/library-heading";
import { LibrarySkeleton } from "@/components/takes/library-skeleton";
import { TakeLibrary } from "@/components/takes/take-library";
import { UploadArea } from "@/components/takes/upload-area";
import { getDb, getSession } from "@/server/request";
import { listForCreator } from "@/server/takes";
import { cardView } from "@/server/takes/views";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your takes · Take Studio" };

/** Library page size (AC-1); the same as GET /api/takes. */
const PAGE_SIZE = 24;

/** The first page of the creator's takes. Throws to the error boundary if it can't load. */
async function Library({ creatorId }: { readonly creatorId: string }) {
  const page = await listForCreator(await getDb(), creatorId, { limit: PAGE_SIZE });
  if (!page.ok) throw new Error("take list failed");
  const now = new Date();
  return (
    <TakeLibrary
      initial={{
        takes: page.data.rows.map((row) => cardView(row, now)),
        nextCursor: page.data.nextCursor,
      }}
      nowIso={now.toISOString()}
    />
  );
}

/** The library (spec 0004 AC-1): upload area on top, takes below. Signed out goes to sign in. */
export default async function LibraryPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const deleted = (await searchParams)[DELETED_PARAM] === "1";
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");

  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <div className="flex flex-col gap-8">
        <LibraryHeading deleted={deleted} />
        <UploadArea />
        <section aria-labelledby="takes-heading" className="flex flex-col gap-4">
          <h2 id="takes-heading" className="sr-only">
            Takes
          </h2>
          <Suspense fallback={<LibrarySkeleton />}>
            <Library creatorId={session.user.id} />
          </Suspense>
        </section>
      </div>
    </AppShell>
  );
}
