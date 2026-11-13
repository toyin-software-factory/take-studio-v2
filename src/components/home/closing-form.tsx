"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import {
  parseSignInEmail,
  SIGN_IN_MESSAGES,
  signInFailureFrom,
  type SignInFailure,
} from "@/lib/sign-in-state";
import { CLOSING } from "./content";

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "invalid" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly email: string }
  | { readonly kind: "failed"; readonly failure: SignInFailure };

/**
 * The closing email form (spec 0010, s8): the draft's underline field and split button, wired to
 * the same Better Auth magic link call as the sign in page. The server already holds the rate
 * limits and the Origin check. Nothing here logs the address. With scripts off the form is a plain
 * GET to /sign-in (the field has no name, so the address never reaches a URL).
 */
export function ClosingForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "sending") return;
    // No `name` on the field (so a no script GET never puts the address in a URL): read it by id.
    const field = event.currentTarget.elements.namedItem("closing-email");
    const email = parseSignInEmail(field instanceof HTMLInputElement ? field.value : "");
    if (!email) {
      setState({ kind: "invalid" });
      return;
    }
    setState({ kind: "sending" });
    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: "/library",
        newUserCallbackURL: "/library",
        errorCallbackURL: "/sign-in/link-expired",
      });
      setState(
        result.error
          ? { kind: "failed", failure: signInFailureFrom(result.error) }
          : { kind: "sent", email },
      );
    } catch {
      setState({ kind: "failed", failure: "error" });
    }
  }

  const failure = state.kind === "failed" ? SIGN_IN_MESSAGES[state.failure] : null;
  const message =
    state.kind === "invalid"
      ? CLOSING.invalid
      : failure
        ? `${failure.title}. ${failure.text}`
        : state.kind === "sent"
          ? `${CLOSING.sentTitle} ${CLOSING.sent(state.email)}`
          : state.kind === "sending"
            ? CLOSING.sending
            : "";

  return (
    <form
      className="h-form"
      action="/sign-in"
      method="get"
      noValidate
      onSubmit={onSubmit}
      data-enter-group
      data-check="s8-contact-form"
    >
      <div className="h-field" data-enter>
        <label htmlFor="closing-email">{CLOSING.emailLabel}</label>
        <input
          id="closing-email"
          type="email"
          autoComplete="email"
          placeholder={CLOSING.emailPlaceholder}
          aria-invalid={state.kind === "invalid"}
          onChange={() => {
            // Editing the address clears an old error (invalid or failed) until the next submit.
            if (state.kind === "invalid" || state.kind === "failed") setState({ kind: "idle" });
          }}
          aria-describedby="closing-status"
          required
        />
      </div>
      <div className="h-closing-actions-inner" data-enter>
        <button
          type="submit"
          className="h-btn-split"
          disabled={state.kind === "sending"}
          data-check="s8-contact-cta"
        >
          <span className="h-btn-split-label" data-check="s8-contact-cta-2">
            {CLOSING.cta}
          </span>
          <span className="h-btn-split-icon" aria-hidden="true" data-check="s8-contact-cta-3">
            <svg width="18" height="18" viewBox="0 0 18 18" focusable="false">
              <path d="M3 9h12M10 4l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
        </button>
        <p
          id="closing-status"
          className="h-form-status"
          role={state.kind === "invalid" || state.kind === "failed" ? "alert" : "status"}
        >
          {message}
        </p>
        <p className="h-closing-note">
          {CLOSING.signInNote}{" "}
          <Link className="h-link-plain" href="/sign-in">
            {CLOSING.signInLink}
          </Link>
        </p>
        <p className="h-closing-note">
          {CLOSING.questions}{" "}
          <a className="h-link-plain" href={`mailto:${CLOSING.email}`}>
            {CLOSING.email}
          </a>
        </p>
      </div>
    </form>
  );
}
