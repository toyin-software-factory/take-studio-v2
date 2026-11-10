import { headers } from "next/headers";
import { getAuth } from "@/server/request";
import { SignInButton, SignOutButton } from "./auth-buttons";

export const dynamic = "force-dynamic";

// Placeholder landing page for the scaffold. No features and no design work yet.
export default async function Home() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main>
      <h1>Take Studio</h1>
      <p>Upload a take. Get it back trimmed, on a studio background, with a transcript.</p>
      {session ? (
        <section aria-label="Account">
          <p>Signed in as {session.user.email}</p>
          <SignOutButton />
        </section>
      ) : (
        <SignInButton />
      )}
    </main>
  );
}
