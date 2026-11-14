"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { lineAt } from "@/lib/teleprompter";
import type { Prompter } from "./use-prompter";

/**
 * The script over the top of the preview (near the lens on a laptop, at the top of a phone
 * screen). It is display only and never in the recording. It scrolls with the prompter's
 * position, or, when the device asks for reduced motion, steps one line at a time with the
 * current line highlighted and no smooth scrolling.
 */
export function PrompterText({
  prompter,
  followWordIndex = null,
}: {
  readonly prompter: Prompter;
  /** The next word to say, from voice following; null keeps the timed scroll. */
  readonly followWordIndex?: number | null;
}) {
  const { lines, settings, reducedMotion, position, active, paused, setLineIndex } = prompter;
  const box = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const follow = useRef<number | null>(null);
  useEffect(() => {
    follow.current = followWordIndex;
  }, [followWordIndex]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      // Voice following moves the script to the matched word; the timed position is only a fallback.
      if (follow.current !== null) position.current = follow.current;
      const index = lineAt(lines, position.current);
      const line = lines[index];
      const node = el.children[index] as HTMLElement | undefined;
      if (line && node) {
        // Smooth: inside the line by the words passed. Reduced motion: the line's top.
        const inside = reducedMotion ? 0 : (position.current - line.startWord) / line.words;
        el.scrollTop = node.offsetTop - el.offsetTop + inside * node.offsetHeight;
      }
      if (index !== current.current) {
        current.current = index;
        setLineIndex(index);
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [lines, reducedMotion, position, setLineIndex, settings.size]);

  if (lines.length === 0) return null;
  const showHighlight = reducedMotion && active;
  return (
    <div
      ref={box}
      role="region"
      aria-label="Your script"
      data-testid="script-scroll"
      data-paused={paused ? "true" : "false"}
      style={{ fontSize: `${settings.size}px`, scrollBehavior: "auto" }}
      className="mx-auto max-h-[45%] w-full max-w-3xl overflow-hidden rounded-md bg-nav-glass-dark px-4 py-2 text-center leading-snug font-medium text-on-dark"
    >
      {lines.map((line, index) => (
        <p
          key={line.startWord}
          data-current={showHighlight && index === prompter.lineIndex ? "true" : undefined}
          className={cn(
            "rounded-sm px-2 py-1",
            showHighlight && index === prompter.lineIndex
              ? "bg-glass text-on-dark"
              : showHighlight
                ? "text-on-dark-75"
                : null,
          )}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}
