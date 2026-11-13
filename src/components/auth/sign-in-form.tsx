"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import {
  SIGN_IN_MESSAGES,
  type SignInFailure,
  looksLikeEmail,
  signInFailureFrom,
} from "@/lib/sign-in-state";

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly email: string }
  | { readonly kind: "failed"; readonly why: SignInFailure };

/**
 * Sign in (spec 0006, AC-1, AC-4, AC-8): "Continue with Google", a divider, then "Email me a
 * sign in link". States: idle, sending, sent ("Check your inbox", the same for any address, so
 * nobody can tell whether an account exists), error, and rate limited. `notice` shows the
 * expired or used link message (AC-2) above the form, with the same way to ask for a new link.
 */
export function SignInForm({ notice }: { readonly notice?: "link_expired" }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  async function sendLink() {
    if (!looksLikeEmail(email)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setState({ kind: "sending" });
    try {
      const result = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: "/library",
        newUserCallbackURL: "/library",
        errorCallbackURL: "/sign-in/link-expired",
      });
      setState(
        result.error
          ? { kind: "failed", why: signInFailureFrom(result.error) }
          : { kind: "sent", email: email.trim() },
      );
    } catch {
      setState({ kind: "failed", why: "error" });
    }
  }

  async function google() {
    setGooglePending(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/library",
      });
      if (result.error) setState({ kind: "failed", why: "error" });
    } catch {
      setState({ kind: "failed", why: "error" });
    } finally {
      setGooglePending(false);
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <Icon icon={Mail} size="empty" className="text-primary" />
        <h2 className="text-h3">Check your inbox</h2>
        <p>
          If <strong className="font-medium">{state.email}</strong> can sign in, a link is on its
          way. It works once and expires in 15 minutes.
        </p>
        <p className="text-small text-muted-foreground">
          Nothing there? Check your spam folder, or send it again.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void sendLink()}>
            Send it again
          </Button>
          <Button variant="ghost" onClick={() => setState({ kind: "idle" })}>
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <div className="flex flex-col gap-6">
      {notice === "link_expired" ? (
        <Alert variant="warning" title="That link has expired or was already used">
          Links work once and last 15 minutes. Send yourself a new one below.
        </Alert>
      ) : null}
      {state.kind === "failed" ? (
        <Alert variant="danger" title={SIGN_IN_MESSAGES[state.why].title}>
          {SIGN_IN_MESSAGES[state.why].text}
        </Alert>
      ) : null}

      <Button variant="secondary" size="lg" loading={googlePending} onClick={() => void google()}>
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-small text-muted-foreground" role="separator">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void sendLink();
        }}
      >
        <Field
          id="sign-in-email"
          label="Email"
          {...(invalid ? { error: "Enter an email address like you@example.com." } : {})}
        >
          {(props) => (
            <Input
              {...props}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" loading={sending}>
          {sending ? "Sending" : "Email me a sign in link"}
        </Button>
      </form>
    </div>
  );
}
