"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { KEY_COPY } from "@/lib/api-keys-screen";

/**
 * The show once panel (spec 0018 AC-12). Focus moves to its heading when it appears. The key is
 * a read only, full width, monospace field that wraps (a secret is never truncated). Copy uses
 * the Clipboard API; if that is denied the field is selected and the status says to press
 * Ctrl+C. "Copied" is a polite status. A leave warning (`beforeunload`) holds while it is open;
 * "I have saved it" closes it and the parent drops the key from state.
 */
export function NewKeyPanel({
  name,
  rawKey,
  onDone,
}: {
  readonly name: string;
  readonly rawKey: string;
  readonly onDone: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("");

  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = KEY_COPY.leaveWarning;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rawKey);
      setStatus(KEY_COPY.copied);
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus(KEY_COPY.copyDenied);
    }
  }

  return (
    <section
      aria-labelledby="new-key-heading"
      className="grid max-w-xl gap-4 rounded-md border border-line bg-surface p-5"
    >
      <h2
        id="new-key-heading"
        ref={heading}
        tabIndex={-1}
        className="text-h4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
      >
        Your new key: {name}
      </h2>
      <p className="text-small text-ink">{KEY_COPY.shownOnce}</p>
      <label htmlFor="new-key-value" className="sr-only">
        New API key
      </label>
      <textarea
        id="new-key-value"
        ref={field}
        readOnly
        rows={2}
        value={rawKey}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => event.currentTarget.select()}
        className="w-full resize-none rounded-sm border border-line bg-bg p-3 font-mono text-small break-all text-ink outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void copy()}>
          <Icon icon={status === KEY_COPY.copied ? Check : Copy} size="badge" />
          Copy key
        </Button>
        <Button onClick={onDone}>I have saved it</Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-small text-ink">
        {status}
      </p>
    </section>
  );
}
