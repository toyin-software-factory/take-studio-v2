"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CONSENT_CAN, CONSENT_COPY, consentAnswerSchema, followableUrl } from "@/lib/oauth-screen";

type Choice = "allow" | "deny";

/** Sends the answer to Better Auth with the signed query exactly as this page got it. */
async function answer(accept: boolean): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: window.location.search.slice(1) }),
    });
    if (!response.ok) return null;
    const parsed = consentAnswerSchema.safeParse(await response.json().catch(() => null));
    return parsed.success ? followableUrl(parsed.data.url) : null;
  } catch {
    return null;
  }
}

/**
 * The consent card (spec 0019 AC-15): the app's name as text, the host it returns you to, what it
 * can do, then Allow and Deny as plain buttons. A polite status line says what is happening; a
 * failure keeps both buttons and moves focus to the alert. Nothing here keeps or shows a code.
 */
export function ConsentForm({
  appName,
  hosts,
  email,
}: {
  readonly appName: string;
  readonly hosts: readonly string[];
  readonly email: string;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function decide(next: Choice) {
    if (choice !== null || done) return;
    setChoice(next);
    setError(false);
    const url = await answer(next === "allow");
    if (url === null) {
      setChoice(null);
      setError(true);
      return;
    }
    setDone(true);
    window.location.assign(url);
  }

  const busy = choice !== null;
  return (
    <section aria-labelledby="consent-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 id="consent-title" className="text-h2">
          {CONSENT_COPY.title}
        </h1>
        <dl className="grid gap-2 rounded-md border border-hairline p-4 text-small">
          <div>
            <dt className="text-muted-foreground">{CONSENT_COPY.appLabel}</dt>
            <dd data-testid="consent-app" className="text-body font-medium break-words">
              {appName}
            </dd>
          </div>
          {hosts.length > 0 ? (
            <div>
              <dt className="text-muted-foreground">{CONSENT_COPY.returnLabel}</dt>
              <dd data-testid="consent-hosts" className="font-mono break-all">
                {hosts.join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-h4">{CONSENT_COPY.canIntro}</h2>
        <ul className="grid gap-3">
          {CONSENT_CAN.map((line) => (
            <li key={line} className="flex items-start gap-3">
              <Icon icon={Check} size="ui" className="mt-0.5" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-small text-ink">{CONSENT_COPY.cannot}</p>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-small">
        {busy || done ? CONSENT_COPY.working : null}
      </p>
      {error ? (
        <p
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-2 rounded-sm text-small text-danger outline-hidden"
        >
          <Icon icon={CircleAlert} size="badge" className="mt-0.5" />
          {CONSENT_COPY.failed}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          loading={choice === "allow"}
          disabled={busy}
          onClick={() => void decide("allow")}
        >
          {CONSENT_COPY.allow}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={choice === "deny"}
          disabled={busy}
          onClick={() => void decide("deny")}
        >
          {CONSENT_COPY.deny}
        </Button>
      </div>
      <p className="text-small text-muted-foreground">Signed in as {email}</p>
    </section>
  );
}
