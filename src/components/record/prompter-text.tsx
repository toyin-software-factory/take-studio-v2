"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { lineAt } from "@/lib/teleprompter";
import type { Prompter } from "./use-prompter";

/** Text rows are about this many times the font size tall (leading-snug plus the padding). */
const ROW_HEIGHT = 1.375;

/**
 * The script over the top of the preview (near the lens on a laptop, at the top of a phone
 * screen). It is display only and never in the recording. It scrolls with the prompter's
 * position, or, when the device asks for reduced motion, steps one line at a time with the
 * current line highlighted and no smooth scrolling.
 */
export function PrompterText({ prompter }: { readonly prompter: Prompter }) {
  const { lines, settings, reducedMotion, position, active, paused, setLineIndex } = prompter;
  const box = useRef<HTMLDivElement>(null);
  const current = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      const index = lineAt(lines, position.current);
      const line = lines[index];
      const node = el.children[index] as HTMLElement | undefined;
      if (line && node) {
        // Smooth: inside the line by the words passed. Reduced motion: no smooth movement, but a
        // paragraph taller than the box steps through its wrapped rows so none stays hidden.
        const inside = (position.current - line.startWord) / line.words;
        const rows = Math.max(1, Math.round(node.offsetHeight / (settings.size * ROW_HEIGHT)));
        const shown = reducedMotion ? (Math.floor(inside * rows) / rows) * node.offsetHeight : 0;
        el.scrollTop =
          node.offsetTop - el.offsetTop + (reducedMotion ? shown : inside * node.offsetHeight);
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
