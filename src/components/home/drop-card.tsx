"use client";

import Link from "next/link";
import { useRef } from "react";
import { DROP_COPY, REFUSAL_HEADING, dropStep } from "@/lib/guest-drop";
import { DropEmailForm, DropSent } from "./drop-email";
import { DropProgress } from "./drop-progress";
import { DropResult } from "./drop-result";
import { DropSteps } from "./drop-steps";
import { DropZone } from "./drop-zone";
import { dropBusy, useGuestDrop } from "./use-guest-drop";

/**
 * The homepage drop card (spec 0023 AC-1, AC-2, AC-13): drop or choose a video, watch it upload,
 * type an email while it runs, get the link. One card, no modal, nothing needs a mouse.
 */
export function DropCard({ siteKey }: { readonly siteKey: string | null }) {
  const mount = useRef<HTMLDivElement>(null);
  const g = useGuestDrop(siteKey, mount);
  const { drop, email } = g;
  const live =
    drop.kind === "done" ? DROP_COPY.done : drop.kind === "uploading" ? DROP_COPY.uploading : "";
  const working = dropBusy(drop) || drop.kind === "done";

  return (
    <section className="h-drop" aria-labelledby="drop-title" data-check="drop-card">
      <h2 className="h-drop-h" id="drop-title">
        {DROP_COPY.heading}
      </h2>
      <DropSteps step={dropStep(drop.kind, email.kind === "sent")} />
      <p className="h-sr-only" role="status">
        {live}
      </p>
      {working ? (
        <DropProgress state={drop} onCancel={g.cancel} />
      ) : drop.kind === "refused" ? (
        <div className="h-drop-refused" role="alert">
          {REFUSAL_HEADING[drop.refusal] ? (
            <h3 className="h-drop-stop">{REFUSAL_HEADING[drop.refusal]}</h3>
          ) : null}
          <p>{drop.message}</p>
          <Link className="h-btn h-drop-btn" href="/sign-in">
            {DROP_COPY.signIn}
          </Link>
        </div>
      ) : (
        <DropZone
          onFile={g.choose}
          alert={drop.kind === "rejected" || drop.kind === "failed" ? drop.message : undefined}
          kept
          retry={
            drop.kind === "failed" && drop.canRetry
              ? { label: DROP_COPY.retry, run: g.retry }
              : undefined
          }
        />
      )}
      {working ? (
        email.kind === "sent" ? (
          <DropSent
            address={email.address}
            again={email.again}
            waiting={dropBusy(drop)}
            onResend={() => g.submitEmail(email.address, true)}
            onChange={g.changeEmail}
          />
        ) : (
          <DropEmailForm state={email} onSubmit={g.submitEmail} />
        )
      ) : null}
      {drop.kind === "done" ? <DropResult /> : null}
      <div ref={mount} className="h-drop-turnstile" />
    </section>
  );
}
