"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "./auth-client";

function useAuthAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: { message?: string } | null }>) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result.error) setError(result.error.message ?? "Something went wrong. Please try again.");
      return !result.error;
    } catch {
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run };
}

function ErrorMessage({ error }: { error: string | null }) {
  return error ? <p role="alert">{error}</p> : null;
}

export function SignInButton() {
  const { pending, error, run } = useAuthAction();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(() => authClient.signIn.social({ provider: "google", callbackURL: "/" }))
        }
      >
        Sign in with Google
      </button>
      <ErrorMessage error={error} />
    </>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const { pending, error, run } = useAuthAction();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (await run(() => authClient.signOut())) router.refresh();
        }}
      >
        Sign out
      </button>
      <ErrorMessage error={error} />
    </>
  );
}
