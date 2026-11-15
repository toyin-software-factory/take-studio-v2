"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { lineAt } from "@/lib/teleprompter";
import type { Prompter } from "./use-prompter";

/** Text rows are about this many times the font size tall (line height plus the row padding). */
const ROW_HEIGHT = 1.35;

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
  // The first voice target since following (re)started or resumed, and whether a newer one has arrived.
  const firstTarget = useRef<number | null>(null);
  // The clamped position when the first target arrived; held until a newer target.
  const heldPosition = useRef(0);
  const engaged = useRef(false);
  useEffect(() => {
    follow.current = followWordIndex;
  }, [followWordIndex]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      // Voice following moves the script to the matched word (not while paused); the timed position is only a fallback.
      if (follow.current !== null && !paused) {
        // The first voice target after fallback or a pause never moves the script back from a later
        // reading position, however many frames pass. Once a new target arrives, the voice is the
        // truth about where the creator is.
        if (firstTarget.current === null) {
          firstTarget.current = follow.current;
          heldPosition.current = Math.max(position.current, follow.current);
        }
        if (follow.current !== firstTarget.current) engaged.current = true;
        position.current = engaged.current ? follow.current : heldPosition.current;
      } else {
        firstTarget.current = null;
        engaged.current = false;
      }
      const index = lineAt(lines, position.current);
      const line = lines[index];
      const node = el.children[index] as HTMLElement | undefined;
      if (line && node) {
        // Smooth: inside the line by the words passed. Reduced motion: no smooth movement, but a
        // paragraph taller than the box steps through its wrapped rows so none stays hidden.
        const inside = (position.current - line.startWord) / line.words;
        const rows = Math.max(1, Math.round(node.offsetHeight / (settings.size * ROW_HEIGHT)));
        const shown = reducedMotion ? (Math.floor(inside * rows) / rows) * node.offsetHeight : 0;
        // The first line rests on the reading line (the top padding), so it is not subtracted.
        const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
        el.scrollTop =
          node.offsetTop -
          el.offsetTop -
          pad +
          (reducedMotion ? shown : inside * node.offsetHeight);
      }
      if (index !== current.current) {
        current.current = index;
        setLineIndex(index);
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [lines, reducedMotion, paused, position, setLineIndex, settings.size]);

  if (lines.length === 0) return null;
  const showHighlight = reducedMotion && active;
  return (
    <div
      ref={box}
      role="region"
      aria-label="Your script"
      data-testid="script-scroll"
      data-check="s2-stage-text"
      data-paused={paused ? "true" : "false"}
      style={{
        fontSize: `${settings.size}px`,
        scrollBehavior: "auto",
        padding: "calc(38cqh - 0.675em) 24px 70cqh",
      }}
      className="rst-ptext mx-auto h-full w-full overflow-hidden text-center font-normal tracking-[-0.005em] text-on-dark-60"
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
                : !showHighlight && index <= prompter.lineIndex
                  ? "text-on-dark"
                  : null,
          )}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}
