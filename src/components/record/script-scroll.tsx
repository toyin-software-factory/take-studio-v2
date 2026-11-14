"use client";

import { useEffect, useRef } from "react";
import { scrollFraction, wordCount } from "@/lib/recorder-rules";

/**
 * The script over the preview (spec 0021 task 1): plain text that scrolls from the top to the
 * end at a steady speed while recording. It is display only; the recording never includes it.
 * Task 2 replaces the fixed speed with the teleprompter controls.
 */
export function ScriptScroll({
  script,
  elapsedMs,
  active,
}: {
  readonly script: string;
  readonly elapsedMs: number;
  readonly active: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fraction = active ? scrollFraction(elapsedMs, wordCount(script)) : 0;
    el.scrollTop = fraction * Math.max(0, el.scrollHeight - el.clientHeight);
  }, [script, elapsedMs, active]);

  if (script.trim() === "") return null;
  return (
    <div
      ref={box}
      data-testid="script-scroll"
      tabIndex={0}
      aria-label="Your script"
      className="max-h-[45%] overflow-y-auto rounded-md bg-nav-glass-dark px-4 py-3 text-center text-h3 leading-snug text-on-dark"
    >
      <p className="whitespace-pre-wrap">{script}</p>
    </div>
  );
}
