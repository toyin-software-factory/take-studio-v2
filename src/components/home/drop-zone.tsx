"use client";

import { useRef, useState } from "react";
import { DROP_COPY } from "@/lib/guest-drop";

/**
 * The idle drop zone (spec 0023 AC-1, AC-13): a dashed target, one sentence, a real Choose
 * button and the rules in small text. Dragging a file is an extra: the button always works, and
 * the zone's words change on drag so colour is never the only signal.
 */
export function DropZone({
  onFile,
  alert,
  retry,
  kept,
}: {
  readonly onFile: (file: File | undefined) => void | Promise<void>;
  /** A friendly message from the last attempt, shown above the zone. */
  readonly alert?: string;
  readonly retry?: { readonly label: string; readonly run: () => void };
  /** Said only when Try again really reuses the file the creator already chose. */
  readonly kept?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="h-drop-zone"
      data-dragging={dragging || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onFile(event.dataTransfer.files[0]);
      }}
    >
      {alert ? (
        <p className="h-drop-alert" role="alert">
          {alert}
        </p>
      ) : null}
      <svg className="h-drop-icon" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="h-drop-title">{dragging ? DROP_COPY.drag : DROP_COPY.idle}</p>
      <input
        ref={input}
        className="h-sr-only"
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        aria-label="Choose a video"
        tabIndex={-1}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="h-drop-actions">
        <button type="button" className="h-btn h-drop-btn" onClick={() => input.current?.click()}>
          {retry ? DROP_COPY.another : DROP_COPY.choose}
        </button>
        {retry ? (
          <button type="button" className="h-drop-link" onClick={retry.run}>
            {retry.label}
          </button>
        ) : null}
      </div>
      {retry && kept ? <p className="h-drop-muted">{DROP_COPY.kept}</p> : null}
      <p className="h-drop-rules">{DROP_COPY.rules}</p>
    </div>
  );
}
