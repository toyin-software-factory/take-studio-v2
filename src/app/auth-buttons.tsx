"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "./auth-client";

export function SignInButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({ provider: "google", callbackURL: "/" });
      }}
    >
      Sign in with Google
    </button>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.refresh();
        setPending(false);
      }}
    >
      Sign out
    </button>
  );
}
