"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DROP_COPY, sentLine } from "@/lib/guest-drop";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { parseSignInEmail } from "@/lib/sign-in-state";
import type { EmailState } from "./use-guest-drop";

/**
 * The email step (spec 0023 AC-2): one label, one field, one button, one notice line, open while
 * the upload runs. Inline in the same card, no modal.
 */
export function DropEmailForm({
  state,
  onSubmit,
}: {
  readonly state: EmailState;
  readonly onSubmit: (address: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const busy = state.kind === "sending";
  const error = invalid ? DROP_COPY.invalidEmail : state.kind === "error" ? state.message : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const field = event.currentTarget.elements.namedItem("drop-email");
    const address = parseSignInEmail(field instanceof HTMLInputElement ? field.value : "");
    setInvalid(!address);
    if (address) onSubmit(address);
  }

  return (
    <form className="h-drop-email" noValidate onSubmit={submit}>
      <div className="h-field">
        <label htmlFor="drop-email">{DROP_COPY.emailLabel}</label>
        <input
          id="drop-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-describedby="drop-email-hint drop-email-error"
          aria-invalid={error ? true : undefined}
          defaultValue={state.kind === "sending" ? state.address : undefined}
        />
        <p className="h-drop-muted" id="drop-email-hint">
          {DROP_COPY.emailHint}
        </p>
        <p className="h-drop-alert" id="drop-email-error" role="alert">
          {error}
        </p>
      </div>
      <button type="submit" className="h-btn h-drop-btn" disabled={busy}>
        {busy ? DROP_COPY.sending : DROP_COPY.send}
      </button>
      <p className="h-drop-muted">
        By continuing you agree to the{" "}
        <Link className="h-link-plain" href={LEGAL_LINKS.terms.href}>
          {LEGAL_LINKS.terms.label}
        </Link>{" "}
        and the{" "}
        <Link className="h-link-plain" href={LEGAL_LINKS.privacy.href}>
          {LEGAL_LINKS.privacy.label}
        </Link>
        .
      </p>
    </form>
  );
}

/** After the link went out (spec 0023 AC-2): the address, what to do, resend and change. */
export function DropSent({
  address,
  again,
  onResend,
  onChange,
  waiting,
}: {
  readonly address: string;
  readonly again: boolean;
  readonly onResend: () => void;
  readonly onChange: () => void;
  /** True while the upload is still running, so the page says to keep the tab open. */
  readonly waiting: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="h-drop-sent">
      <h3 className="h-drop-h" ref={heading} tabIndex={-1}>
        {DROP_COPY.sentHeading}
      </h3>
      <p>{sentLine(address)}</p>
      <p className="h-drop-muted">{DROP_COPY.spam}</p>
      <p className="h-drop-muted">{DROP_COPY.expiry}</p>
      {waiting ? <p className="h-drop-muted">{DROP_COPY.waiting}</p> : null}
      <p className="h-drop-muted" role="status">
        {again ? DROP_COPY.resent : ""}
      </p>
      <div className="h-drop-row">
        <button type="button" className="h-drop-link" onClick={onResend}>
          {DROP_COPY.resend}
        </button>
        <button type="button" className="h-drop-link" onClick={onChange}>
          {DROP_COPY.change}
        </button>
      </div>
    </div>
  );
}
