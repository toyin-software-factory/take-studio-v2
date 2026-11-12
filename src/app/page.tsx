import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { HomePage } from "@/components/home/home-page";
import { AppShell } from "@/components/shell/app-shell";
import { LibrarySkeleton } from "@/components/takes/library-skeleton";
import { TakeLibrary } from "@/components/takes/take-library";
import { UploadArea } from "@/components/takes/upload-area";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteOrigin } from "@/lib/site";
import { getDb, getSession } from "@/server/request";
import { listForCreator } from "@/server/takes";
import { cardView } from "@/server/takes/views";

export const dynamic = "force-dynamic";

/** One session lookup per request, shared by the page and its metadata. */
const loadSession = cache(async () => getSession(await headers()));

/**
 * Signed in: the library's own title. Signed out: the homepage's title, description, canonical
 * URL and share cards (spec 0010, AC-3). The share image is `opengraph-image.jpg` next to this
 * file; the absolute URLs need the site origin, which comes from `BETTER_AUTH_URL`.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (await loadSession()) return { title: "Your takes · Take Studio" };
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  const title = `${SITE_TITLE} · ${SITE_NAME}`;
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title,
    description: SITE_DESCRIPTION,
    // Relative URLs resolve against `metadataBase`; without an origin they are left out.
    ...(origin ? { alternates: { canonical: "/" } } : {}),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description: SITE_DESCRIPTION,
      ...(origin ? { url: "/" } : {}),
    },
    twitter: { card: "summary_large_image", title, description: SITE_DESCRIPTION },
  };
}

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

/** Home: the homepage when signed out (spec 0010), the library when signed in (AC-1): upload area on top, takes below. */
export default async function Home() {
  const session = await loadSession();
  if (!session) return <HomePage origin={siteOrigin(process.env.BETTER_AUTH_URL)} />;

  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <div className="flex flex-col gap-8">
        <h1 className="text-h1 font-medium">Your takes</h1>
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
