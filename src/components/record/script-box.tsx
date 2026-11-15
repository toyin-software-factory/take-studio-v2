"use client";

import { useId } from "react";
import { notify } from "@/components/ui/sonner";
import { charCount, countWords, readingTime } from "./script-stats";

/**
 * The script field (draft step 1): a counter, the words and reading time, "Saved on this
 * device" (the draft is kept per creator on the device) and Clear. Clear shows a polite
 * "Script cleared" toast with Undo, which puts the script and its device copy back.
 */
export function ScriptBox({
  script,
  onScript,
  max,
  wpm,
}: {
  readonly script: string;
  readonly onScript: (value: string) => void;
  readonly max: number;
  readonly wpm: number;
}) {
  const id = useId();
  const words = countWords(script);
  const clear = () => {
    if (script === "") return;
    const previous = script;
    onScript("");
    notify("default", {
      title: "Script cleared",
      action: { label: "Undo", onClick: () => onScript(previous) },
    });
  };
  return (
    <div className="rec-script">
      <label htmlFor={id}>
        <span>Script (optional)</span>
        <span className="tabular-nums">{charCount(script.length, max)}</span>
      </label>
      <textarea
        id={id}
        value={script}
        maxLength={max}
        placeholder="Paste or type what you want to say. It scrolls near the top of the screen, close to the camera, while you record."
        onChange={(event) => onScript(event.target.value)}
      />
      <p className="rec-meta">
        <span>
          {words.toLocaleString("en-GB")} {words === 1 ? "word" : "words"}
        </span>
        <span>{readingTime(words, wpm)}</span>
        <span>Saved on this device</span>
        <button type="button" data-check="s1-setup-cta" onClick={clear}>
          Clear
        </button>
      </p>
    </div>
  );
}
