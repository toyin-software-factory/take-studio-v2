import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { SkipLink } from "@/components/shell/skip-link";
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

/** Signed out landing placeholder: name, one line, sign in. The real landing page is feature 15. */
function Landing() {
  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-content flex-col items-start justify-center gap-4 px-4 outline-hidden md:px-6"
      >
        <h1 className="text-h1 font-semibold">Take Studio</h1>
        <p className="text-text-muted">
          Upload a take. Get it back trimmed, on a studio background, with a transcript.
        </p>
        <Button asChild size="lg">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </main>
    </>
  );
}

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

/** Home: the library when signed in (AC-1): upload area on top, takes below. */
export default async function Home() {
  const session = await getSession(await headers());
  if (!session) return <Landing />;

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      <div className="flex flex-col gap-8">
        <h1 className="text-h1 font-semibold">Your takes</h1>
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
