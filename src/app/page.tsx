import { headers } from "next/headers";
import { Film } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";
import { getAuth } from "@/server/request";
import { SignInButton } from "./auth-buttons";

export const dynamic = "force-dynamic";

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
        <SignInButton />
      </main>
    </>
  );
}

/** Home: the take list will live here (slice 1). Until then, the signed in empty state. */
export default async function Home() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <Landing />;

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      <h1 className="text-h1 font-semibold">Your takes</h1>
      <div className="mt-8 flex flex-col items-center gap-3 rounded-md bg-surface px-6 py-12 text-center shadow-card">
        <Icon icon={Film} size="empty" className="text-text-muted" />
        <p className="max-w-prose">No takes yet. Uploading arrives with the core take loop.</p>
      </div>
    </AppShell>
  );
}
