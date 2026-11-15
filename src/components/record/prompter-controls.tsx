"use client";

import { Minus, Pause, Play, Plus } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { Prompter } from "./use-prompter";

/**
 * Pause and resume the script, speed and text size. Buttons and keyboard shortcuts (P, Up and
 * Down, + and -) do the same thing. Pausing the script never pauses the recording. Changes are
 * announced politely once, never every second.
 */
/** The round Pause or Resume script button that sits in the dock beside Record. */
export function PauseButton({ prompter }: { readonly prompter: Prompter }) {
  const { paused, run } = prompter;
  return (
    <button
      type="button"
      className="rst-btn"
      data-round
      data-check="s2-stage-cta-4"
      aria-label={paused ? "Resume script" : "Pause script"}
      aria-keyshortcuts="P"
      data-testid="prompter-toggle"
      onClick={() => run("toggle")}
    >
      <Icon icon={paused ? Play : Pause} />
    </button>
  );
}

export function PrompterControls({ prompter }: { readonly prompter: Prompter }) {
  const { settings, run, announcement } = prompter;
  return (
    <div
      role="group"
      aria-label="Script controls"
      data-testid="prompter-controls"
      className="flex flex-col gap-4"
    >
      <Stepper
        label="Speed"
        value={`${settings.wpm} wpm`}
        lessLabel="Slower"
        moreLabel="Faster"
        onLess={() => run("slower")}
        onMore={() => run("faster")}
        testId="prompter-speed"
      />
      <Stepper
        label="Text size"
        value={`${settings.size} px`}
        lessLabel="Smaller text"
        moreLabel="Larger text"
        onLess={() => run("smaller")}
        onMore={() => run("larger")}
        testId="prompter-size"
      />
      <p className="rst-keys">
        Keys: P pause, Up and Down speed, + and − size. The recording keeps going.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function Stepper({
  label,
  value,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly lessLabel: string;
  readonly moreLabel: string;
  readonly onLess: () => void;
  readonly onMore: () => void;
  readonly testId: string;
}) {
  return (
    <div role="group" aria-label={label} className="rst-row">
      <span>{label}</span>
      <div className="rst-stepper">
        <button
          type="button"
          className="rst-btn"
          data-round
          aria-label={lessLabel}
          onClick={onLess}
        >
          <Icon icon={Minus} />
        </button>
        <output className="mono" data-testid={testId}>
          {value}
        </output>
        <button
          type="button"
          className="rst-btn"
          data-round
          aria-label={moreLabel}
          onClick={onMore}
        >
          <Icon icon={Plus} />
        </button>
      </div>
    </div>
  );
}
