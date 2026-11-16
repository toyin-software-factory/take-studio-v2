"use client";

import { useRef, useState } from "react";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  CONNECTED_COPY,
  type ConnectedAppView,
  clientLabel,
  connectedDate,
  connectedLastUsed,
} from "@/lib/oauth-screen";
import { DisconnectAppDialog } from "./disconnect-app-dialog";
import { useConnectedApps } from "./use-connected-apps";

/**
 * "Connected apps" beside the API keys (spec 0019 AC-14): each app's name as text, when it was
 * connected, last used, and a Disconnect button with a confirm. A polite status line says the
 * result. Focus: a cancelled confirm returns to its button; a disconnect moves to the heading.
 */
export function ConnectedApps() {
  const { load, retry, disconnect } = useConnectedApps();
  const [target, setTarget] = useState<ConnectedAppView | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby="connected-heading" className="grid gap-4">
      <div className="grid gap-2">
        <h2
          id="connected-heading"
          ref={heading}
          tabIndex={-1}
          className="text-h4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
        >
          {CONNECTED_COPY.heading}
        </h2>
        <p className="text-small text-ink">{CONNECTED_COPY.intro}</p>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {load.kind === "loading" ? (
        <p className="text-small text-ink">{CONNECTED_COPY.loading}</p>
      ) : load.kind === "failed" ? (
        <div className="grid justify-items-start gap-3">
          <p role="alert" className="text-small text-danger">
            {CONNECTED_COPY.loadFailed}
          </p>
          <Button variant="secondary" size="sm" onClick={retry}>
            {CONNECTED_COPY.retry}
          </Button>
        </div>
      ) : load.apps.length === 0 ? (
        <p className="flex items-start gap-3 text-small text-ink">
          <Icon icon={Plug} size="ui" className="mt-0.5" />
          {CONNECTED_COPY.empty}
        </p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {load.apps.map((app) => {
            const name = clientLabel(app.name);
            return (
              <li key={app.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
                <p className="min-w-0 flex-1 basis-60 font-medium break-words">{name}</p>
                <dl className="grid grid-cols-2 gap-x-6 text-small text-ink">
                  <div>
                    <dt className="text-muted-foreground">Connected</dt>
                    <dd>{connectedDate(app.connectedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last used</dt>
                    <dd>{connectedLastUsed(app.lastUsedAt)}</dd>
                  </div>
                </dl>
                <Button
                  id={`disconnect-${app.id}`}
                  variant="secondary"
                  size="sm"
                  aria-label={`Disconnect ${name}`}
                  onClick={() => {
                    setTarget(app);
                    setOpen(true);
                  }}
                >
                  Disconnect
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <DisconnectAppDialog
        target={target ? { id: target.id, name: clientLabel(target.name) } : null}
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (id) => {
          const done = await disconnect(id);
          if (done) {
            setStatus(CONNECTED_COPY.disconnected);
          }
          return done;
        }}
        returnFocus={(id) => document.getElementById(`disconnect-${id}`)}
        afterDisconnectFocus={() => heading.current?.focus()}
      />
    </section>
  );
}
